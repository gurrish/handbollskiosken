import { TableClient, type TableEntity } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { z } from "zod";
import type { Image, Slide } from "./domain.js";

export interface Repository {
  listSlides(): Promise<Slide[]>;
  getSlide(id: string): Promise<Slide | undefined>;
  saveSlide(slide: Slide): Promise<void>;
  deleteSlide(id: string): Promise<void>;
  saveImage(id: string, image: Image): Promise<void>;
  readImage(id: string): Promise<Image | undefined>;
  deleteImage(id: string): Promise<void>;
}

type StoredSlide = TableEntity<Record<string, unknown>>;

const storedSlideSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(["image", "link"]),
  url: z.string().nullable(),
  imageContentType: z.string().nullable(),
  imageName: z.string().nullable(),
  durationSeconds: z.number(),
  isActive: z.boolean(),
  position: z.number(),
  createdAt: z.string(),
});

function fromEntity(entity: StoredSlide): Slide {
  const slide = storedSlideSchema.safeParse({
    id: entity.rowKey,
    title: entity.title,
    description: entity.description,
    kind: entity.kind,
    url: entity.url ?? null,
    imageContentType: entity.imageContentType ?? null,
    imageName: entity.imageName ?? null,
    durationSeconds: entity.durationSeconds,
    isActive: entity.isActive,
    position: entity.position,
    createdAt: entity.createdAt,
  });
  if (!slide.success) throw new Error(`Stored slide ${entity.rowKey} has invalid data.`);
  return slide.data;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "statusCode" in error && error.statusCode === 404;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "statusCode" in error && error.statusCode === 409;
}

export class MemoryRepository implements Repository {
  private readonly slides = new Map<string, Slide>();
  private readonly images = new Map<string, Image>();

  async listSlides(): Promise<Slide[]> {
    return [...this.slides.values()].map((slide) => structuredClone(slide));
  }
  async getSlide(id: string): Promise<Slide | undefined> {
    const slide = this.slides.get(id);
    return slide ? structuredClone(slide) : undefined;
  }
  async saveSlide(slide: Slide): Promise<void> {
    this.slides.set(slide.id, structuredClone(slide));
  }
  async deleteSlide(id: string): Promise<void> {
    this.slides.delete(id);
  }
  async saveImage(id: string, image: Image): Promise<void> {
    this.images.set(id, { bytes: Buffer.from(image.bytes), contentType: image.contentType });
  }
  async readImage(id: string): Promise<Image | undefined> {
    const image = this.images.get(id);
    return image ? { bytes: Buffer.from(image.bytes), contentType: image.contentType } : undefined;
  }
  async deleteImage(id: string): Promise<void> {
    this.images.delete(id);
  }
}

export class TableRepository implements Repository {
  private readonly table: TableClient;
  private readonly blobs: BlobServiceClient;

  constructor(connectionString: string) {
    this.table = TableClient.fromConnectionString(connectionString, "KioskSlides");
    this.blobs = BlobServiceClient.fromConnectionString(connectionString);
  }

  private async ensureTable() {
    try {
      await this.table.createTable();
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  async listSlides(): Promise<Slide[]> {
    await this.ensureTable();
    const slides: Slide[] = [];
    for await (const entity of this.table.listEntities<StoredSlide>()) slides.push(fromEntity(entity));
    return slides;
  }

  async getSlide(id: string): Promise<Slide | undefined> {
    try {
      const entity = await this.table.getEntity<StoredSlide>("slides", id);
      return fromEntity(entity);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async saveSlide(slide: Slide): Promise<void> {
    await this.ensureTable();
    const { id, url, imageContentType, imageName, ...fields } = slide;
    await this.table.upsertEntity({
      partitionKey: "slides",
      rowKey: id,
      ...fields,
      ...(url === null ? {} : { url }),
      ...(imageContentType === null ? {} : { imageContentType }),
      ...(imageName === null ? {} : { imageName }),
    }, "Replace");
  }

  async deleteSlide(id: string): Promise<void> {
    try {
      await this.table.deleteEntity("slides", id);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private container() {
    return this.blobs.getContainerClient("kiosk-content");
  }

  async saveImage(id: string, image: Image): Promise<void> {
    const container = this.container();
    await container.createIfNotExists();
    await container.getBlockBlobClient(id).uploadData(image.bytes, {
      blobHTTPHeaders: { blobContentType: image.contentType },
    });
  }

  async readImage(id: string): Promise<Image | undefined> {
    try {
      const blob = this.container().getBlockBlobClient(id);
      const [bytes, properties] = await Promise.all([blob.downloadToBuffer(), blob.getProperties()]);
      return { bytes, contentType: properties.contentType || "application/octet-stream" };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async deleteImage(id: string): Promise<void> {
    await this.container().getBlockBlobClient(id).deleteIfExists();
  }
}

let repository: Repository | undefined;
export function getRepository(): Repository {
  if (repository) return repository;
  const mode = process.env.STORAGE_MODE ?? (process.env.NODE_ENV === "development" ? "memory" : "table");
  if (mode === "memory") repository = new MemoryRepository();
  else if (mode === "table" && process.env.STORAGE_CONNECTION_STRING) {
    repository = new TableRepository(process.env.STORAGE_CONNECTION_STRING);
  } else {
    throw new Error("Configure STORAGE_CONNECTION_STRING with STORAGE_MODE=table, or use STORAGE_MODE=memory locally.");
  }
  return repository;
}
