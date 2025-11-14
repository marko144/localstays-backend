# PWA Push Notifications - Frontend Integration Guide

**Status:** Phase 1 Complete - Infrastructure deployed to staging  
**Last Updated:** 2025-11-13

## Overview

This guide provides the essential information for frontend developers to integrate Web Push notifications into the Localstays PWA.

---

## 1. Service Worker Setup

### 1.1 Register Service Worker

```javascript
// In your main app file (e.g., index.tsx)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      console.log("Service Worker registered:", registration);
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  });
}
```

### 1.2 Service Worker File (`public/sw.js`)

```javascript
// public/sw.js
self.addEventListener("push", function (event) {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.icon || "/icon-192x192.png",
    badge: data.badge || "/badge-72x72.png",
    data: data.data,
    actions: data.actions || [],
    tag: data.tag,
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  // Handle action buttons
  if (event.action) {
    console.log("Action clicked:", event.action);
  }

  // Open URL if provided
  const urlToOpen = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(urlToOpen));
});
```

---

## 2. Request Permission & Subscribe

### 2.1 Request Permission

```typescript
async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    throw new Error("Notifications not supported");
  }

  return await Notification.requestPermission();
}
```

### 2.2 Get VAPID Public Key

```typescript
const VAPID_PUBLIC_KEY =
  "BGKqFLPQH4q5CjiBpfGWv6muNOG1gBLBD5ktfizhLsSgK1jjjDeZF4nj0pFT8yD7aBL5manRUKWAOVJiSWjyNPA";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
```

### 2.3 Subscribe to Push Notifications

```typescript
async function subscribeToPush(): Promise<void> {
  try {
    // 1. Request permission
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      throw new Error("Permission denied");
    }

    // 2. Get service worker registration
    const registration = await navigator.serviceWorker.ready;

    // 3. Subscribe to push service
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // 4. Send subscription to backend
    const response = await fetch(
      "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/notifications/subscribe",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getJwtToken()}`, // Your JWT token
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to subscribe on backend");
    }

    const data = await response.json();
    console.log("Subscribed successfully:", data.subscriptionId);

    // Store subscription ID locally for unsubscribe later
    localStorage.setItem("pushSubscriptionId", data.subscriptionId);
  } catch (error) {
    console.error("Failed to subscribe:", error);
    throw error;
  }
}
```

---

## 3. Unsubscribe

```typescript
async function unsubscribeFromPush(): Promise<void> {
  try {
    // 1. Get subscription ID from localStorage
    const subscriptionId = localStorage.getItem("pushSubscriptionId");
    if (!subscriptionId) {
      throw new Error("No subscription found");
    }

    // 2. Unsubscribe from push service
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }

    // 3. Delete subscription from backend
    const response = await fetch(
      `https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/notifications/subscribe/${subscriptionId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${getJwtToken()}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to unsubscribe on backend");
    }

    // 4. Clear local storage
    localStorage.removeItem("pushSubscriptionId");
    console.log("Unsubscribed successfully");
  } catch (error) {
    console.error("Failed to unsubscribe:", error);
    throw error;
  }
}
```

---

## 4. Check Subscription Status

```typescript
async function getSubscriptionStatus(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    return (
      subscription !== null &&
      localStorage.getItem("pushSubscriptionId") !== null
    );
  } catch (error) {
    console.error("Failed to check subscription status:", error);
    return false;
  }
}
```

---

## 5. List User's Subscriptions (Optional)

```typescript
interface Subscription {
  subscriptionId: string;
  deviceType: "desktop" | "mobile" | "tablet";
  platform: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string;
}

async function listSubscriptions(): Promise<Subscription[]> {
  const response = await fetch(
    "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/notifications/subscriptions",
    {
      headers: {
        Authorization: `Bearer ${getJwtToken()}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch subscriptions");
  }

  const data = await response.json();
  return data.subscriptions;
}
```

---

## 6. Testing Push Notifications (Admin Only)

```typescript
// Admin endpoint to test sending notifications
async function sendTestNotification(userId: string): Promise<void> {
  const response = await fetch(
    "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/admin/notifications/send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAdminJwtToken()}`,
      },
      body: JSON.stringify({
        targetType: "user",
        targetIds: [userId],
        notification: {
          title: "Test Notification",
          body: "This is a test notification",
          icon: "/icon-192x192.png",
          data: {
            url: "/dashboard",
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to send notification");
  }

  console.log("Test notification sent");
}
```

---

## 7. Example: Complete Integration

```typescript
// components/NotificationSettings.tsx
import { useState, useEffect } from "react";

export function NotificationSettings() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    const status = await getSubscriptionStatus();
    setIsSubscribed(status);
  }

  async function handleToggle() {
    setLoading(true);
    try {
      if (isSubscribed) {
        await unsubscribeFromPush();
        setIsSubscribed(false);
      } else {
        await subscribeToPush();
        setIsSubscribed(true);
      }
    } catch (error) {
      alert("Failed to update notification settings");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Push Notifications</h2>
      <button onClick={handleToggle} disabled={loading}>
        {loading ? "Loading..." : isSubscribed ? "Disable" : "Enable"}
      </button>
      <p>Status: {isSubscribed ? "Enabled" : "Disabled"}</p>
    </div>
  );
}
```

---

## 8. Browser Support

| Browser        | Support                       |
| -------------- | ----------------------------- |
| Chrome         | ✅ Yes                        |
| Firefox        | ✅ Yes                        |
| Safari (macOS) | ✅ Yes (v16.4+)               |
| Safari (iOS)   | ✅ Yes (v16.4+, requires PWA) |
| Edge           | ✅ Yes                        |

**Note:** On iOS, push notifications only work when the app is added to the home screen (installed as PWA).

---

## 9. Environment Variables

```env
# .env.staging
NEXT_PUBLIC_API_URL=https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BGKqFLPQH4q5CjiBpfGWv6muNOG1gBLBD5ktfizhLsSgK1jjjDeZF4nj0pFT8yD7aBL5manRUKWAOVJiSWjyNPA
```

---

## 10. Best Practices

1. **Ask at the Right Time:** Don't prompt for notification permission immediately on page load. Wait for a relevant user action.
2. **Explain the Value:** Show users what they'll receive before asking for permission.
3. **Handle Denial Gracefully:** If permission is denied, don't keep asking. Provide alternative ways to stay updated.
4. **Respect User Preferences:** Make it easy to unsubscribe.
5. **Test on Real Devices:** Push notifications behave differently on mobile vs desktop.
6. **Monitor Subscription Health:** Check `/api/v1/notifications/subscriptions` periodically to detect inactive subscriptions.

---

## 11. Next Steps

**Phase 2 (Later):**

- Add specific notification types for different events
- Implement notification preferences (user can choose which events to receive)
- Add notification history/inbox

**Current Phase (Phase 1):**

- ✅ Infrastructure deployed
- ✅ Subscribe/unsubscribe endpoints ready
- ✅ Backend utility functions ready for triggering notifications from business logic

---

## 12. Support

For questions or issues, contact the backend team or refer to:

- Web Push API Docs: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Service Worker Docs: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API





