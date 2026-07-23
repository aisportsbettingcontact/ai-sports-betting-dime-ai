## 🗺️ Maps Integration

**CRITICAL: The maps helper routes through the legacy `BUILT_IN_FORGE_*` gateway.** On Railway those variables are unset, so maps calls throw. If maps features are needed, supply your own `GOOGLE_MAPS_API_KEY` integration instead of relying on the legacy proxy.

**Default: Use Frontend SDK** - Import MapView from `client/src/components/Map.tsx` and initialize ANY Google Maps service (geocoding, directions, places, drawing, visualization, geometry, etc.) in the onMapReady callback. 

**Use Backend API only when:**
- Persisting data (save routes/locations to database)
- Bulk operations (1000+ addresses)
- Server-side needs (caching, scheduled jobs, hiding business logic)

**Implementation:**
- Frontend: See `client/src/components/Map.tsx` for component usage - ALL Google Maps JavaScript API features work
- Backend: Create tRPC procedures using `makeRequest` from `server/_core/map.ts`

The helpers above depend on the legacy `BUILT_IN_FORGE_*` gateway, which is not provisioned on Railway — bring your own `GOOGLE_MAPS_API_KEY` (or an external map library) if maps are needed in production.
