export interface Slide {
  id: string;
  title: string;
  description: string;
  kind: "image" | "link";
  url: string | null;
  durationSeconds: number;
  isActive: boolean;
  position: number;
  createdAt: string;
  imageUrl: string | null;
}

export interface SlideInput {
  title: string;
  description: string;
  kind: "image" | "link";
  url: string | null;
  durationSeconds: number;
  isActive: boolean;
  image?: { name: string; contentType: string; base64: string };
}

export interface Viewer {
  signedIn: boolean;
  email: string | null;
  isAdmin: boolean;
}
