# Forgot Password Flow

This document explains how the forgot password (password reset) functionality works in the Localstays backend.

---

## 🎯 Overview

The backend uses **AWS Cognito's built-in forgot password functionality** with a **Custom Email Sender Lambda trigger** to send password reset emails via SendGrid (instead of SES).

**Key Benefits:**

- ✅ Cognito handles all the security logic (code generation, validation, expiration)
- ✅ SendGrid delivers the emails (not SES)
- ✅ No additional backend APIs needed
- ✅ Frontend directly calls Cognito SDK

---

## 🔄 Complete Flow

### 1️⃣ User Requests Password Reset (Frontend)

```typescript
import { resetPassword } from "aws-amplify/auth";

// User enters their email
await resetPassword({ username: email });
```

**What happens:**

- Frontend calls Cognito's `forgotPassword` API
- Cognito generates a 6-digit reset code
- Cognito encrypts the code with KMS
- Cognito triggers our Custom Email Sender Lambda

---

### 2️⃣ Lambda Sends Reset Email (Backend)

**Trigger:** `CustomEmailSender_ForgotPassword`

**Lambda does:**

1. Receives encrypted code from Cognito
2. Decrypts code using AWS Encryption SDK + KMS
3. Gets plaintext 6-digit code (e.g., `"582941"`)
4. Builds reset link: `http://localhost:3000/en/reset-password?username=<uuid>&code=582941`
5. Sends email via SendGrid with reset link

**Email sent to user:**

- Subject: "Reset your Localstays password"
- Contains a "Reset Password" button with the link
- Code expires in **1 hour** (Cognito default)

---

### 3️⃣ User Clicks Reset Link (Frontend)

User receives email and clicks the "Reset Password" button, which opens:

```
http://localhost:3000/en/reset-password?username=<uuid>&code=582941
```

The frontend page should:

1. Extract `username` and `code` from URL query params
2. Show a form for the new password
3. When user submits, call Cognito's confirm reset API

---

### 4️⃣ User Submits New Password (Frontend)

```typescript
import { confirmResetPassword } from "aws-amplify/auth";

// Extract from URL
const searchParams = new URLSearchParams(window.location.search);
const username = searchParams.get("username");
const code = searchParams.get("code");

// When user submits new password
await confirmResetPassword({
  username: username,
  confirmationCode: code,
  newPassword: newPassword,
});
```

**What happens:**

- Frontend sends username, code, and new password to Cognito
- Cognito validates the code (checks it's correct and not expired)
- If valid, Cognito updates the user's password
- User can now sign in with their new password

---

## 🧪 Testing the Flow

### Test via AWS CLI:

```bash
# 1. Request password reset
aws cognito-idp forgot-password \
  --client-id 71pg4njsq769kohtqefp6h7olc \
  --username marko@slingshots.app \
  --region eu-north-1

# 2. Check your email for the 6-digit code

# 3. Confirm password reset
aws cognito-idp confirm-forgot-password \
  --client-id 71pg4njsq769kohtqefp6h7olc \
  --username marko@slingshots.app \
  --confirmation-code "582941" \
  --password "NewPassword123!" \
  --region eu-north-1
```

---

## 📝 Frontend Implementation Guide

### Create `/en/reset-password` page:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { confirmResetPassword } from "aws-amplify/auth";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const usernameParam = searchParams.get("username");
    const codeParam = searchParams.get("code");

    if (usernameParam) setUsername(usernameParam);
    if (codeParam) setCode(codeParam);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await confirmResetPassword({
        username,
        confirmationCode: code,
        newPassword,
      });
      setSuccess(true);
    } catch (err: any) {
      console.error("Password reset error:", err);
      setError(err.message || "Failed to reset password");
    }
  };

  if (success) {
    return (
      <div>
        <h1>Password Reset Successful!</h1>
        <p>You can now sign in with your new password.</p>
        <a href="/en/login">Go to Login</a>
      </div>
    );
  }

  return (
    <div>
      <h1>Reset Your Password</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="New Password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
        />
        <button type="submit">Reset Password</button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

### Create "Forgot Password" page:

```typescript
"use client";

import { useState } from "react";
import { resetPassword } from "aws-amplify/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await resetPassword({ username: email });
      setSuccess(true);
    } catch (err: any) {
      console.error("Forgot password error:", err);
      setError(err.message || "Failed to send reset email");
    }
  };

  if (success) {
    return (
      <div>
        <h1>Check Your Email</h1>
        <p>We've sent a password reset link to {email}</p>
        <p>The link will expire in 1 hour.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Forgot Password?</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit">Send Reset Link</button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

---

## 🔐 Security Features

### Code Expiration

- Reset codes expire in **1 hour** (Cognito default)
- Old codes become invalid after successful reset

### Rate Limiting

- Cognito limits the number of reset requests per user
- Prevents spam/abuse

### Encryption

- Reset codes are encrypted with KMS in transit
- Lambda decrypts them before sending via email

---

## 🚨 Common Errors

### `CodeMismatchException`

- **Cause:** User entered wrong code or code expired
- **Solution:** Request a new reset link

### `LimitExceededException`

- **Cause:** Too many reset attempts
- **Solution:** Wait 15 minutes and try again

### `UserNotFoundException`

- **Cause:** Email doesn't exist in Cognito
- **Solution:** User needs to sign up first

---

## 🔧 Configuration

### Backend (Lambda Environment Variables)

```typescript
RESET_PASSWORD_URL_BASE = "http://localhost:3000/en/reset-password";
```

**For production, update this to:**

```typescript
RESET_PASSWORD_URL_BASE = "https://yourdomain.com/en/reset-password";
```

### Frontend Routes Required

- `/en/forgot-password` - Form to request reset
- `/en/reset-password` - Form to set new password (with `username` and `code` query params)

---

## 📊 Monitoring

Check CloudWatch logs for the Lambda:

```bash
aws logs tail /aws/lambda/localstays-dev-custom-email-sender \
  --follow \
  --region eu-north-1 \
  --filter-pattern "ForgotPassword"
```

Look for:

- `CustomEmailSender_ForgotPassword` trigger
- Decrypted code logs
- SendGrid send success/failure

---

## ✅ Summary

**No additional backend APIs needed!** Everything is handled by:

1. **Cognito** - Security, code generation, validation
2. **Lambda** - Email sending via SendGrid
3. **Frontend** - UI and Cognito SDK calls

The entire flow is serverless, secure, and requires zero custom backend logic beyond the email sending Lambda (which we already have).
