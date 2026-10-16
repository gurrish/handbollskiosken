import type { Slide, SlideInput, Viewer } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (import.meta.env.DEV) {
    const email = localStorage.getItem("handbollskiosken-dev-email");
    if (email !== null) headers.set("x-dev-user-email", email);
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Något gick fel (felkod ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export const getSlides = (includeInactive = false) =>
  request<Slide[]>(`/api/slides${includeInactive ? "?all=true" : ""}`);
export const getViewer = () => request<Viewer>("/api/me");
export const createSlide = (slide: SlideInput) =>
  request<Slide>("/api/slides", { method: "POST", body: JSON.stringify(slide) });
export const updateSlide = (id: string, slide: SlideInput) =>
  request<Slide>(`/api/slides/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(slide) });
export const deleteSlide = (id: string) =>
  request<{ ok: true }>(`/api/slides/${encodeURIComponent(id)}`, { method: "DELETE" });
