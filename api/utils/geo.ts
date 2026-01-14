export interface Location {
  lat: number
  lon: number
}

export interface ReplicaRegion {
  id: string       // 'us-west', 'us-east', 'eu-west'
  lat: number
  lon: number
  binding: string  // DO binding name like 'DO_US_WEST'
}

/**
 * Convert degrees to radians
 */
function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

/**
 * Calculate the great-circle distance between two points using Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistance(from: Location, to: Location): number {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(to.lat - from.lat)
  const dLon = toRad(to.lon - from.lon)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

/**
 * Find the nearest replica region to a given location.
 * Returns null if no regions provided.
 */
export function findNearestReplica(
  location: Location,
  regions: ReplicaRegion[]
): ReplicaRegion | null {
  if (!regions || regions.length === 0) return null

  let nearest: ReplicaRegion | null = null
  let minDistance = Infinity

  for (const region of regions) {
    const distance = haversineDistance(location, {
      lat: region.lat,
      lon: region.lon,
    })
    if (distance < minDistance) {
      minDistance = distance
      nearest = region
    }
  }

  return nearest
}
