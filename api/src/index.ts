import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { createSlideInput, updateSlideInput, type Image, type ImageInput, type Slide } from "./domain.js";
import { getRepository } from "./repository.js";

interface Identity {
  id: string;
  email: string;
}

interface PrincipalClaim {
  typ: string;
  val: string;
}

interface ClientPrincipal {
  userDetails: string;
  userId: string;
  claims?: PrincipalClaim[];
}

function isPrincipalClaim(value: unknown): value is PrincipalClaim {
  return Boolean(value && typeof value === "object"
    && "typ" in value && typeof value.typ === "string"
    && "val" in value && typeof value.val === "string");
}

function isClientPrincipal(value: unknown): value is ClientPrincipal {
  return Boolean(value && typeof value === "object"
    && "userDetails" in value && typeof value.userDetails === "string"
    && "userId" in value && typeof value.userId === "string"
    && (!("claims" in value) || (Array.isArray(value.claims) && value.claims.every(isPrincipalClaim))));
}

type PublicSlide = Omit<Slide, "imageContentType" | "imageName"> & { imageUrl: string | null };

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function identity(request: HttpRequest): Identity | undefined {
  const encoded = request.headers.get("x-ms-client-principal");
  if (!encoded && process.env.DEV_AUTH === "true" && process.env.NODE_ENV !== "production") {
    const devEmail = request.headers.get("x-dev-user-email");
    const email = (devEmail === null ? process.env.DEV_AUTH_EMAIL || "" : devEmail).trim().toLowerCase();
    return email ? { id: email, email } : undefined;
  }
  if (!encoded) return undefined;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!isClientPrincipal(parsed)) return undefined;
    const principal = parsed;
    const claimEmail = principal.claims?.find((claim) =>
      /(?:email|upn|preferred_username)/i.test(claim.typ) && claim.val.includes("@"),
    )?.val;
    const email = principal.userDetails.includes("@") ? principal.userDetails : claimEmail;
    if (!email) return undefined;
    return { id: principal.userId, email: email.trim().toLowerCase() };
  } catch {
    return undefined;
  }
}

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.GLOBAL_ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

function requireAdmin(request: HttpRequest) {
  const actor = identity(request);
  if (!actor) throw new HttpError(401, "Logga in för att hantera kioskens innehåll.");
  if (!isAdmin(actor.email)) throw new HttpError(403, "Det här kontot är inte global administratör.");
  return actor;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Begäran innehåller ogiltig JSON.");
  }
}

function parseImage(input: ImageInput): Image {
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new HttpError(400, "Bilden måste vara högst 8 MB.");
  const signatures: Record<ImageInput["contentType"], number[]> = {
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "image/webp": [0x52, 0x49, 0x46, 0x46],
  };
  const signature = signatures[input.contentType];
  if (!signature.every((byte, index) => bytes[index] === byte)
    || (input.contentType === "image/webp" && bytes.toString("ascii", 8, 12) !== "WEBP")) {
    throw new HttpError(400, "Den uppladdade filen stämmer inte överens med bildformatet.");
  }
  return { bytes, contentType: input.contentType };
}

function publicSlide(slide: Slide): PublicSlide {
  const { imageContentType: _imageContentType, imageName: _imageName, ...details } = slide;
  return { ...details, imageUrl: slide.kind === "image" ? `/api/slides/${encodeURIComponent(slide.id)}/image` : null };
}

function responsePath(pathname: string): string[] {
  try {
    return pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, "Adressen innehåller ogiltig kodning.");
  }
}

export async function handle(request: HttpRequest, context: InvocationContext): Promise<Response> {
  try {
    const [api, resource, id, action] = responsePath(new URL(request.url).pathname);
    if (api !== "api") throw new HttpError(404, "API-adressen kunde inte hittas.");
    const method = request.method.toUpperCase();
    const repo = getRepository();

    if (resource === "me" && method === "GET") {
      const actor = identity(request);
      return json({ signedIn: Boolean(actor), email: actor?.email ?? null, isAdmin: isAdmin(actor?.email) });
    }
    if (resource !== "slides") throw new HttpError(404, "API-adressen kunde inte hittas.");
    if (!id && method === "GET") {
      const includeInactive = request.query.get("all") === "true";
      if (includeInactive) requireAdmin(request);
      const slides = await repo.listSlides();
      const visible = slides.filter((slide) => includeInactive || slide.isActive);
      visible.sort((first, second) => first.position - second.position || first.createdAt.localeCompare(second.createdAt));
      return json(visible.map(publicSlide));
    }
    if (id && action === "image" && method === "GET") {
      const slide = await repo.getSlide(id);
      if (!slide || (!slide.isActive && !isAdmin(identity(request)?.email))) {
        throw new HttpError(404, "Bilden kunde inte hittas.");
      }
      const image = await repo.readImage(id);
      if (!image) throw new HttpError(404, "Bilden kunde inte hittas.");
      return new Response(image.bytes, {
        headers: {
          "Content-Type": image.contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (!id && method === "POST") {
      requireAdmin(request);
      const parsed = createSlideInput.safeParse(await readBody(request));
      if (!parsed.success) throw new HttpError(400, "Kontrollera innehållet och försök igen.");
      const { image: imageInput, ...details } = parsed.data;
      const existing = await repo.listSlides();
      const slide: Slide = {
        id: randomUUID(),
        ...details,
        imageContentType: imageInput?.contentType ?? null,
        imageName: imageInput?.name ?? null,
        position: existing.reduce((highest, item) => Math.max(highest, item.position), -1) + 1,
        createdAt: new Date().toISOString(),
      };
      if (imageInput) await repo.saveImage(slide.id, parseImage(imageInput));
      try {
        await repo.saveSlide(slide);
      } catch (error) {
        if (imageInput) await repo.deleteImage(slide.id);
        throw error;
      }
      return json(publicSlide(slide), 201);
    }
    if (id && !action && method === "PUT") {
      requireAdmin(request);
      const current = await repo.getSlide(id);
      if (!current) throw new HttpError(404, "Innehållet kunde inte hittas.");
      const parsed = updateSlideInput.safeParse(await readBody(request));
      if (!parsed.success) throw new HttpError(400, "Kontrollera innehållet och försök igen.");
      const { image: imageInput, ...details } = parsed.data;
      if (details.kind === "image" && !imageInput && current.kind !== "image") {
        throw new HttpError(400, "Välj en bild innan innehållstypen ändras till bild.");
      }
      const updated: Slide = {
        ...current,
        ...details,
        imageContentType: details.kind === "image" ? imageInput?.contentType ?? current.imageContentType : null,
        imageName: details.kind === "image" ? imageInput?.name ?? current.imageName : null,
      };
      if (details.kind === "image" && !updated.imageContentType) {
        throw new HttpError(400, "Välj en bild för bildinnehållet.");
      }
      if (imageInput) await repo.saveImage(id, parseImage(imageInput));
      await repo.saveSlide(updated);
      if (details.kind === "link" && current.kind === "image") await repo.deleteImage(id);
      return json(publicSlide(updated));
    }
    if (id && !action && method === "DELETE") {
      requireAdmin(request);
      if (!await repo.getSlide(id)) throw new HttpError(404, "Innehållet kunde inte hittas.");
      await repo.deleteImage(id);
      await repo.deleteSlide(id);
      return json({ ok: true });
    }
    throw new HttpError(404, "API-adressen kunde inte hittas.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    context.error("Request failed", error);
    return json({ error: "Begäran kunde inte slutföras. Försök igen senare." }, 500);
  }
}

app.http("api", {
  route: "{*path}",
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "anonymous",
  handler: handle,
});
