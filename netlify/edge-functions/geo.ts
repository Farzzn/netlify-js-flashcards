import type { Config, Context } from "@netlify/edge-functions";

export default async (_req: Request, context: Context) => {
  return Response.json({
    city: context.geo?.city || "Local Dev",
    country: context.geo?.country?.name || "Local Network",
    runtime: "Deno at CDN Edge",
  });
};

export const config: Config = {
  path: "/api/geo",
};
