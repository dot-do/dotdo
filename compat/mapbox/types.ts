/**
 * @dotdo/mapbox - Mapbox API Type Definitions
 *
 * Type definitions for Mapbox Web Services API compatibility layer
 */

// =============================================================================
// Common Types
// =============================================================================

/** Geographic coordinates [longitude, latitude] */
export type LngLat = [number, number]

/** Geographic coordinates [longitude, latitude, altitude?] */
export type LngLatAlt = [number, number, number?]

/** Bounding box [minLng, minLat, maxLng, maxLat] */
export type BoundingBox = [number, number, number, number]

/** Language codes supported by Mapbox */
export type LanguageCode = string

/** Country codes (ISO 3166-1 alpha-2) */
export type CountryCode = string

// =============================================================================
// Geocoding Types
// =============================================================================

/** Geocoding feature context - place hierarchy */
export interface GeocodingContext {
  id: string
  mapbox_id?: string
  text: string
  short_code?: string
  wikidata?: string
}

/** Geocoding feature properties */
export interface GeocodingProperties {
  accuracy?: string
  address?: string
  category?: string
  maki?: string
  landmark?: boolean
  wikidata?: string
  short_code?: string
}

/** Individual geocoding result feature */
export interface GeocodingFeature {
  id: string
  type: 'Feature'
  place_type: string[]
  relevance: number
  properties: GeocodingProperties
  text: string
  place_name: string
  matching_text?: string
  matching_place_name?: string
  center: LngLat
  geometry: {
    type: 'Point'
    coordinates: LngLat
  }
  bbox?: BoundingBox
  context?: GeocodingContext[]
  address?: string
}

/** Geocoding API response */
export interface GeocodingResponse {
  type: 'FeatureCollection'
  query: string[] | LngLat
  features: GeocodingFeature[]
  attribution: string
}

/** Forward geocoding options */
export interface ForwardGeocodingOptions {
  /** Limit results to one or more countries (ISO 3166-1 alpha-2) */
  country?: CountryCode | CountryCode[]
  /** Limit results to one or more place types */
  types?: string | string[]
  /** Bias results toward a location [lng, lat] */
  proximity?: LngLat
  /** Limit results to a bounding box */
  bbox?: BoundingBox
  /** Number of results to return (1-10, default 5) */
  limit?: number
  /** Language for results */
  language?: LanguageCode | LanguageCode[]
  /** Include fuzzy matching */
  fuzzyMatch?: boolean
  /** Routing profile for proximity calculation */
  routing?: boolean
  /** Return autocomplete results */
  autocomplete?: boolean
  /** Worldview to use (default: us) */
  worldview?: string
}

/** Reverse geocoding options */
export interface ReverseGeocodingOptions {
  /** Limit results to one or more countries */
  country?: CountryCode | CountryCode[]
  /** Limit results to one or more place types */
  types?: string | string[]
  /** Language for results */
  language?: LanguageCode | LanguageCode[]
  /** Number of results to return (1-5, default 1) */
  limit?: number
  /** Reverse geocoding mode */
  reverseMode?: 'distance' | 'score'
  /** Worldview to use */
  worldview?: string
}

// =============================================================================
// Directions Types
// =============================================================================

/** Routing profile */
export type RoutingProfile =
  | 'mapbox/driving'
  | 'mapbox/driving-traffic'
  | 'mapbox/walking'
  | 'mapbox/cycling'

/** Geometry format */
export type GeometryFormat = 'geojson' | 'polyline' | 'polyline6'

/** Overview detail level */
export type OverviewLevel = 'full' | 'simplified' | 'false'

/** Maneuver type */
export type ManeuverType =
  | 'depart'
  | 'turn'
  | 'new name'
  | 'continue'
  | 'merge'
  | 'on ramp'
  | 'off ramp'
  | 'fork'
  | 'end of road'
  | 'roundabout'
  | 'exit roundabout'
  | 'rotary'
  | 'exit rotary'
  | 'arrive'
  | 'notification'

/** Maneuver modifier */
export type ManeuverModifier =
  | 'uturn'
  | 'sharp right'
  | 'right'
  | 'slight right'
  | 'straight'
  | 'slight left'
  | 'left'
  | 'sharp left'

/** Route step maneuver */
export interface StepManeuver {
  bearing_before: number
  bearing_after: number
  location: LngLat
  type: ManeuverType
  modifier?: ManeuverModifier
  instruction: string
  exit?: number
}

/** Voice instruction */
export interface VoiceInstruction {
  distanceAlongGeometry: number
  announcement: string
  ssmlAnnouncement?: string
}

/** Banner instruction component */
export interface BannerComponent {
  type: string
  text: string
  abbr?: string
  abbr_priority?: number
  imageBaseURL?: string
  imageURL?: string
  active?: boolean
  directions?: string[]
}

/** Banner instruction */
export interface BannerInstruction {
  distanceAlongGeometry: number
  primary: {
    text: string
    type: string
    modifier?: string
    components: BannerComponent[]
    degrees?: number
    driving_side?: string
  }
  secondary?: {
    text: string
    type: string
    components: BannerComponent[]
  }
  sub?: {
    text: string
    type: string
    components: BannerComponent[]
  }
}

/** Route step intersection */
export interface Intersection {
  location: LngLat
  bearings: number[]
  entry: boolean[]
  in?: number
  out?: number
  lanes?: {
    valid: boolean
    active: boolean
    indications: string[]
  }[]
  classes?: string[]
  mapbox_streets_v8?: {
    class: string
  }
  admin_index?: number
  geometry_index?: number
  is_urban?: boolean
  traffic_signal?: boolean
  tunnel_name?: string
  toll_collection?: {
    type: string
    name?: string
  }
  rest_stop?: {
    type: string
    name?: string
  }
}

/** Route leg step */
export interface RouteStep {
  maneuver: StepManeuver
  mode: string
  name: string
  distance: number
  duration: number
  geometry: string | GeoJSONLineString
  weight: number
  driving_side: string
  intersections?: Intersection[]
  ref?: string
  destinations?: string
  exits?: string
  pronunciation?: string
  rotary_name?: string
  rotary_pronunciation?: string
  voiceInstructions?: VoiceInstruction[]
  bannerInstructions?: BannerInstruction[]
}

/** Route leg annotation */
export interface Annotation {
  distance?: number[]
  duration?: number[]
  speed?: number[]
  congestion?: string[]
  congestion_numeric?: number[]
  maxspeed?: Array<{ speed: number; unit: string } | { unknown: true } | { none: true }>
  state_of_charge?: number[]
}

/** Route leg */
export interface RouteLeg {
  distance: number
  duration: number
  summary: string
  weight: number
  steps: RouteStep[]
  annotation?: Annotation
  admins?: Array<{
    iso_3166_1: string
    iso_3166_1_alpha3: string
  }>
  via_waypoints?: Array<{
    waypoint_index: number
    distance_from_start: number
    geometry_index: number
  }>
  incidents?: Array<{
    id: string
    type: string
    description: string
    creation_time: string
    start_time: string
    end_time: string
    closed: boolean
    congestion: {
      value: number
    }
    geometry_index_start: number
    geometry_index_end: number
  }>
}

/** GeoJSON LineString */
export interface GeoJSONLineString {
  type: 'LineString'
  coordinates: LngLat[]
}

/** Single route object */
export interface Route {
  distance: number
  duration: number
  geometry: string | GeoJSONLineString
  weight: number
  weight_name: string
  legs: RouteLeg[]
  voiceLocale?: string
}

/** Waypoint in directions response */
export interface Waypoint {
  name: string
  location: LngLat
  distance?: number
}

/** Directions API response */
export interface DirectionsResponse {
  code: 'Ok' | 'NoRoute' | 'NoSegment' | 'ProfileNotFound' | 'InvalidInput'
  uuid?: string
  routes: Route[]
  waypoints: Waypoint[]
}

/** Directions request options */
export interface DirectionsOptions {
  /** Return alternative routes */
  alternatives?: boolean
  /** Annotations to include */
  annotations?: string | string[]
  /** Request voice instructions */
  voice_instructions?: boolean
  /** Request banner instructions */
  banner_instructions?: boolean
  /** Geometry format */
  geometries?: GeometryFormat
  /** Overview detail level */
  overview?: OverviewLevel
  /** Include steps in route */
  steps?: boolean
  /** Continue straight preference */
  continue_straight?: boolean
  /** Exclude certain road types */
  exclude?: string | string[]
  /** Language for instructions */
  language?: LanguageCode
  /** Roundabout exits */
  roundabout_exits?: boolean
  /** Departure time for traffic routing */
  depart_at?: string
  /** Arrival time for traffic routing */
  arrive_by?: string
  /** Waypoint snapping options */
  approaches?: string | string[]
  /** Waypoint bearings */
  bearings?: string | string[]
  /** Waypoint radii for snapping */
  radiuses?: string | string[]
  /** Waypoint names */
  waypoint_names?: string | string[]
  /** Waypoint targets for route guidance */
  waypoint_targets?: string | string[]
  /** Waypoints as via points */
  waypoints?: string | string[]
  /** Max height for vehicle */
  max_height?: number
  /** Max width for vehicle */
  max_width?: number
  /** Max weight for vehicle */
  max_weight?: number
}

// =============================================================================
// Map Tiles Types
// =============================================================================

/** Tile format */
export type TileFormat = 'png' | 'png32' | 'png64' | 'png128' | 'png256' | 'jpg70' | 'jpg80' | 'jpg90' | 'webp'

/** Tileset ID */
export type TilesetId = string

/** Raster tile options */
export interface RasterTileOptions {
  /** Tileset ID (e.g., mapbox.satellite) */
  tilesetId: TilesetId
  /** Zoom level (0-22) */
  zoom: number
  /** Tile X coordinate */
  x: number
  /** Tile Y coordinate */
  y: number
  /** Tile format */
  format?: TileFormat
  /** High DPI (@2x) */
  highDpi?: boolean
}

/** Vector tile options */
export interface VectorTileOptions {
  /** Tileset ID */
  tilesetId: TilesetId
  /** Zoom level */
  zoom: number
  /** Tile X coordinate */
  x: number
  /** Tile Y coordinate */
  y: number
}

// =============================================================================
// Static Images Types
// =============================================================================

/** Static map marker */
export interface StaticMarker {
  /** Marker name (pin-s, pin-l, or custom) */
  name?: 'pin-s' | 'pin-l' | string
  /** Marker label (single character) */
  label?: string
  /** Marker color (hex without #) */
  color?: string
  /** Marker position [lng, lat] */
  coordinates: LngLat
  /** Custom marker URL */
  url?: string
}

/** Static map path/polyline */
export interface StaticPath {
  /** Path stroke color */
  stroke?: string
  /** Path stroke width */
  strokeWidth?: number
  /** Path stroke opacity (0-1) */
  strokeOpacity?: number
  /** Path fill color */
  fill?: string
  /** Path fill opacity (0-1) */
  fillOpacity?: number
  /** Path coordinates */
  coordinates: LngLat[]
}

/** GeoJSON overlay for static maps */
export interface StaticGeoJSON {
  /** GeoJSON object */
  geojson: object
}

/** Static map options */
export interface StaticMapOptions {
  /** Style ID (e.g., mapbox/streets-v12) */
  styleId?: string
  /** Custom style URL */
  styleUrl?: string
  /** Map center [lng, lat] - auto if not specified */
  center?: LngLat | 'auto'
  /** Zoom level */
  zoom?: number
  /** Map bearing (rotation) in degrees */
  bearing?: number
  /** Map pitch (tilt) in degrees */
  pitch?: number
  /** Image width in pixels */
  width: number
  /** Image height in pixels */
  height: number
  /** High DPI (@2x) */
  highDpi?: boolean
  /** Markers to display */
  markers?: StaticMarker[]
  /** Paths to display */
  paths?: StaticPath[]
  /** GeoJSON overlays */
  geoJSON?: StaticGeoJSON[]
  /** Whether to add attribution */
  attribution?: boolean
  /** Whether to add logo */
  logo?: boolean
  /** Padding for auto-fit */
  padding?: number
  /** Before layer ID for overlays */
  beforeLayer?: string
}

/** Static map response */
export interface StaticMapResponse {
  /** Image data as ArrayBuffer */
  data: ArrayBuffer
  /** Content type */
  contentType: string
  /** Image width */
  width: number
  /** Image height */
  height: number
}

// =============================================================================
// Search/Places Types (Mapbox Search Box API)
// =============================================================================

/** Place category */
export type PlaceCategory = string

/** Search suggestion */
export interface SearchSuggestion {
  name: string
  mapbox_id: string
  feature_type: string
  address?: string
  full_address?: string
  place_formatted?: string
  context?: {
    country?: { name: string; country_code: string }
    region?: { name: string; region_code?: string }
    postcode?: { name: string }
    district?: { name: string }
    place?: { name: string }
    locality?: { name: string }
    neighborhood?: { name: string }
    street?: { name: string }
    address?: { name: string; address_number?: string }
  }
  language: string
  maki?: string
  poi_category?: string[]
  poi_category_ids?: string[]
  brand?: string[]
  brand_id?: string[]
  external_ids?: Record<string, string>
  metadata?: Record<string, unknown>
  distance?: number
  eta?: number
}

/** Search suggestions response */
export interface SearchSuggestionsResponse {
  suggestions: SearchSuggestion[]
  attribution: string
  url?: string
}

/** Retrieved place feature */
export interface PlaceFeature {
  type: 'Feature'
  id: string
  geometry: {
    type: 'Point'
    coordinates: LngLat
  }
  properties: {
    name: string
    mapbox_id: string
    feature_type: string
    address?: string
    full_address?: string
    place_formatted?: string
    context?: Record<string, unknown>
    coordinates?: {
      longitude: number
      latitude: number
      accuracy?: string
      routable_points?: Array<{
        name: string
        latitude: number
        longitude: number
      }>
    }
    bbox?: BoundingBox
    language?: string
    maki?: string
    poi_category?: string[]
    poi_category_ids?: string[]
    brand?: string[]
    brand_id?: string[]
    external_ids?: Record<string, string>
    metadata?: Record<string, unknown>
    operational_status?: string
  }
}

/** Place retrieve response */
export interface PlaceRetrieveResponse {
  type: 'FeatureCollection'
  features: PlaceFeature[]
  attribution: string
}

/** Search suggest options */
export interface SearchSuggestOptions {
  /** Session token for billing */
  sessionToken?: string
  /** Proximity bias [lng, lat] */
  proximity?: LngLat
  /** Origin for ETA calculation */
  origin?: LngLat
  /** Bounding box to limit results */
  bbox?: BoundingBox
  /** Country codes to limit results */
  country?: CountryCode | CountryCode[]
  /** Language for results */
  language?: LanguageCode
  /** Result limit (1-10) */
  limit?: number
  /** Navigation profile for ETA */
  navigation_profile?: RoutingProfile
  /** Route for along-the-route search */
  route?: string
  /** Route geometry format */
  route_geometry?: 'polyline' | 'polyline6'
  /** Time deviation for route search */
  sar_type?: 'isochrone' | 'none'
  /** Time deviation in minutes */
  time_deviation?: number
  /** ETA type */
  eta_type?: 'navigation' | 'none'
  /** Types to search for */
  types?: string | string[]
  /** POI categories */
  poi_category?: string | string[]
  /** POI category exclusions */
  poi_category_exclusions?: string | string[]
}

/** Search retrieve options */
export interface SearchRetrieveOptions {
  /** Session token for billing */
  sessionToken?: string
  /** Language for results */
  language?: LanguageCode
}

// =============================================================================
// Isochrone Types
// =============================================================================

/** Isochrone contour */
export interface IsochroneContour {
  /** Time in minutes */
  minutes?: number
  /** Distance in meters */
  meters?: number
  /** Contour color (hex) */
  color?: string
}

/** Isochrone options */
export interface IsochroneOptions {
  /** Routing profile */
  profile: RoutingProfile
  /** Center coordinates */
  coordinates: LngLat
  /** Contour definitions */
  contours: IsochroneContour[]
  /** Polygon or linestring */
  polygons?: boolean
  /** Denoise factor (0-1) */
  denoise?: number
  /** Generalize tolerance in meters */
  generalize?: number
  /** Departure time */
  depart_at?: string
}

/** Isochrone feature properties */
export interface IsochroneFeatureProperties {
  contour?: number
  color?: string
  opacity?: number
  fill?: string
  'fill-opacity'?: number
  metric?: 'time' | 'distance'
}

/** Isochrone feature */
export interface IsochroneFeature {
  type: 'Feature'
  id: string
  geometry: {
    type: 'Polygon' | 'LineString'
    coordinates: LngLat[] | LngLat[][]
  }
  properties: IsochroneFeatureProperties
}

/** Isochrone response */
export interface IsochroneResponse {
  type: 'FeatureCollection'
  features: IsochroneFeature[]
}

// =============================================================================
// Client Options
// =============================================================================

/** Mapbox client options */
export interface MapboxClientOptions {
  /** Access token */
  accessToken: string
  /** Base URL override */
  baseUrl?: string
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Request timeout in ms */
  timeout?: number
  /** Max retries */
  maxRetries?: number
}

// =============================================================================
// Error Types
// =============================================================================

/** Mapbox API error */
export interface MapboxErrorResponse {
  message: string
  error?: string
}
