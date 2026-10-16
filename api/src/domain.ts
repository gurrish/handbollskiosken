import { z } from "zod";

const imageInput = z.object({
  name: z.string().trim().min(1).max(180),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(11_184_812)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "Bilden har ett ogiltigt format."),
}).strict();

const destination = z.string().trim().min(1).max(2048).url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Länken måste börja med http:// eller https://.");

const slideFields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  kind: z.enum(["image", "link"]),
  url: destination.nullable(),
  durationSeconds: z.number().int().min(5).max(120),
  isActive: z.boolean(),
};

function addContentValidation<T extends z.ZodRawShape>(schema: z.ZodObject<T>, requireImage: boolean) {
  return schema.superRefine((slide, context) => {
    if (slide.kind === "link" && slide.url === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Ange en länk." });
    }
    if (slide.kind === "link" && slide.image) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["image"], message: "En länk ska inte ha någon bild." });
    }
    if (slide.kind === "image" && slide.url !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "En bild ska inte ha någon länk." });
    }
    if (requireImage && slide.kind === "image" && !slide.image) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["image"], message: "Välj en bild." });
    }
  });
}

export const createSlideInput = addContentValidation(
  z.object({ ...slideFields, image: imageInput.optional() }).strict(),
  true,
);
export const updateSlideInput = addContentValidation(
  z.object({ ...slideFields, image: imageInput.optional() }).strict(),
  false,
);
export type SlideInput = z.infer<typeof updateSlideInput>;
export type ImageInput = z.infer<typeof imageInput>;

export interface Slide {
  id: string;
  title: string;
  description: string;
  kind: "image" | "link";
  url: string | null;
  imageContentType: string | null;
  imageName: string | null;
  durationSeconds: number;
  isActive: boolean;
  position: number;
  createdAt: string;
}

export interface Image {
  bytes: Buffer;
  contentType: string;
}
