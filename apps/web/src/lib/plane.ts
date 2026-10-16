/** Where a Plane account lives, for display: its host, or Plane's cloud when it has no base URL. */
export const planeHost = (baseUrl: string | null) => (baseUrl ? new URL(baseUrl).host : "Plane cloud");
