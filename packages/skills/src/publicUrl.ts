/** The address this installation's agent is reached at (PUBLIC_URL), without a trailing slash: the OAuth redirect and API previews live under it. */
export const publicUrl = () => (process.env.PUBLIC_URL || "http://localhost:3001").replace(/\/+$/, "");
