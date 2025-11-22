# Location Search API

## Environment Variable

```bash
NEXT_PUBLIC_GUEST_API_URL=https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/
```

## Endpoint

**GET** `/api/v1/public/locations/search`

### Query Parameters

- `q` (required): Search query (min 2 chars, max 50 chars)

### Example Request

```bash
GET https://40usmhyfm9.execute-api.eu-north-1.amazonaws.com/staging/api/v1/public/locations/search?q=Bel
```

### Response

```json
{
  "locations": [
    {
      "locationId": "dXJuOm1ieHBsYzpBUVRC",
      "name": "Belgrade"
    }
  ]
}
```

### Notes

- No authentication required
- Rate limit: 20 requests/minute per IP
- Returns max 10 results sorted by popularity
- Handles special characters (e.g., searching "Uzi" matches "Užice")
- CORS restricted to localhost and staging.localstays.me
