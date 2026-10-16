import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, Check, Clock3, ExternalLink, ImagePlus, LoaderCircle,
  LogIn, LogOut, Maximize, Pause, Pencil, Play, Plus, ScreenShare, Trash2, X,
} from "lucide-react";
import { ApiError, createSlide, deleteSlide, getSlides, getViewer, updateSlide } from "./lib/api";
import type { Slide, SlideInput, Viewer } from "./types";

const blankForm = {
  title: "",
  description: "",
  kind: "image" as "image" | "link",
  url: "",
  durationSeconds: 15,
  isActive: true,
};
const imageLimit = 8 * 1024 * 1024;

function readImage(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Välj en JPG-, PNG- eller WebP-bild.");
  }
  if (file.size > imageLimit) throw new Error("Bilden får vara högst 8 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") reject(new Error("Det gick inte att läsa bilden."));
      else resolve(reader.result.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Det gick inte att läsa bilden."));
    reader.readAsDataURL(file);
  });
}

function slideInput(slide: Slide, isActive = slide.isActive): SlideInput {
  return {
    title: slide.title,
    description: slide.description,
    kind: slide.kind,
    url: slide.url,
    durationSeconds: slide.durationSeconds,
    isActive,
  };
}

function adminError(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.status === 401) {
    return "Din inloggning verkar ha gått ut. Logga in igen och försök på nytt.";
  }
  if (cause instanceof ApiError && cause.status === 403) {
    return "Det här kontot saknar global administratörsbehörighet.";
  }
  return cause instanceof Error ? cause.message : fallback;
}

function isAuthorizationError(cause: unknown): cause is ApiError {
  return cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
}

function signIn() {
  if (import.meta.env.DEV) {
    const email = window.prompt("Lokal inloggning – ange administratörens e-postadress:");
    if (email) {
      localStorage.setItem("handbollskiosken-dev-email", email.trim());
      window.location.reload();
    }
    return;
  }
  window.location.assign("/.auth/login/aad?post_login_redirect_uri=/admin");
}

function signOut() {
  if (import.meta.env.DEV) {
    localStorage.setItem("handbollskiosken-dev-email", "");
    window.location.reload();
    return;
  }
  window.location.assign("/.auth/logout");
}

export default function App() {
  return window.location.pathname.replace(/\/+$/, "") === "/admin" ? <AdminPage /> : <KioskPage />;
}

function KioskPage() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [time, setTime] = useState(new Date());
  const current = slides[index % Math.max(slides.length, 1)];

  async function refresh() {
    try {
      setSlides(await getSlides());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Det gick inte att hämta kioskens innehåll.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 60_000);
    const clockTimer = window.setInterval(() => setTime(new Date()), 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = window.setTimeout(() => setIndex((currentIndex) => (currentIndex + 1) % slides.length), current?.durationSeconds * 1000 || 15_000);
    return () => window.clearTimeout(timer);
  }, [current?.id, current?.durationSeconds, index, paused, slides.length]);

  function changeSlide(direction: number) {
    if (slides.length < 2) return;
    setIndex((currentIndex) => (currentIndex + direction + slides.length) % slides.length);
  }

  async function enterFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Det gick inte att ändra helskärmsläge i den här webbläsaren.");
    }
  }

  return <main className="kiosk-shell">
    <header className="kiosk-header">
      <a className="brand" href="/" aria-label="Handbollskiosken – bildskärm">
        <span className="brand-mark"><ScreenShare size={20} /></span>
        <span>HANDBOLLS<span>KIOSKEN</span></span>
      </a>
      <div className="kiosk-meta"><span><span className="live-dot" /> DIREKT FRÅN HALLEN</span><time>{new Intl.DateTimeFormat("sv-SE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(time)}</time></div>
      <a className="admin-link" href="/admin">Administrera <ArrowRight size={15} /></a>
    </header>

    <section className="kiosk-main" aria-label="Bildspel">
      {loading ? <div className="kiosk-empty"><LoaderCircle className="spin" size={34} /><p>Hämtar innehåll…</p></div>
        : current ? <article className={`slide-display slide-display-${current.kind}`} key={current.id}>
          {current.kind === "image" && current.imageUrl
            ? <img className="slide-image" src={current.imageUrl} alt={current.title} />
            : current.kind === "link" && current.url
              ? <>
                <iframe
                  className="slide-frame"
                  src={current.url}
                  title={current.title}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-forms allow-popups"
                />
                <div className="slide-overlay">
                  <div className="slide-overlay-copy">
                    <span className="slide-label">HANDBOLLSKIOSKEN</span>
                    <h1>{current.title}</h1>
                    {current.description && <p>{current.description}</p>}
                  </div>
                  <div className="embed-note">
                    <span>Vissa webbplatser tillåter inte inbäddning.</span>
                    <a href={current.url} target="_blank" rel="noreferrer">Öppna sidan separat <ExternalLink size={15} /></a>
                  </div>
                </div>
              </>
              : null}
        </article>
          : <div className="kiosk-empty">
            <span className="empty-mark"><ScreenShare size={33} /></span>
            <span className="eyebrow">HANDBOLLSKIOSKEN</span>
            <h1>{error ? "Innehållet kunde inte hämtas" : "Välkommen till hallen"}</h1>
            <p>{error || "Här visas nyheter, bilder och länkar från vår förening."}</p>
            {error && <button className="button button-dark" onClick={() => { setLoading(true); void refresh(); }}>Försök igen</button>}
          </div>}
    </section>

    {error && current && <div className="kiosk-warning" role="status">{error} Visat innehåll uppdateras när anslutningen är tillbaka.</div>}
    <footer className="kiosk-controls">
      <div className="control-club"><span className="court-icon">H</span><span><strong>HANDBOLL</strong><small>GEMENSKAP PÅ OCH UTANFÖR PLANEN</small></span></div>
      <div className="slide-controls" aria-label="Bildspelskontroller">
        <button className="control-button" onClick={() => changeSlide(-1)} disabled={slides.length < 2} aria-label="Föregående bild"><ArrowLeft size={19} /></button>
        <button className="control-button control-play" onClick={() => setPaused((value) => !value)} disabled={slides.length < 2} aria-label={paused ? "Starta bildspel" : "Pausa bildspel"}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
        <button className="control-button" onClick={() => changeSlide(1)} disabled={slides.length < 2} aria-label="Nästa bild"><ArrowRight size={19} /></button>
      </div>
      <div className="footer-right"><span><Clock3 size={15} /> {current ? `${current.durationSeconds} SEK / BILD` : "BILDVISNING"}</span><button className="control-button fullscreen-button" onClick={() => void enterFullscreen()} aria-label="Växla helskärmsläge"><Maximize size={18} /></button></div>
    </footer>
  </main>;
}

function AdminPage() {
  const [viewer, setViewer] = useState<Viewer>({ signedIn: false, email: null, isAdmin: false });
  const [slides, setSlides] = useState<Slide[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Slide | null>(null);

  async function refresh() {
    setError("");
    try {
      const account = await getViewer();
      setViewer(account);
      setSlides(account.isAdmin ? await getSlides(true) : []);
    } catch (cause) {
      if (isAuthorizationError(cause)) {
        setViewer((current) => cause.status === 401
          ? { signedIn: false, email: null, isAdmin: false }
          : { ...current, isAdmin: false });
      }
      setError(adminError(cause, "Det gick inte att hämta kioskens innehåll."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function save(input: SlideInput) {
    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await updateSlide(editing.id, input)
        : await createSlide(input);
      setSlides((current) => {
        const updated = editing
          ? current.map((slide) => slide.id === saved.id ? saved : slide)
          : [...current, saved];
        return updated.sort((first, second) => first.position - second.position || first.createdAt.localeCompare(second.createdAt));
      });
      setEditorOpen(false);
      setEditing(null);
    } catch (cause) {
      if (isAuthorizationError(cause)) {
        setViewer((current) => cause.status === 401
          ? { signedIn: false, email: null, isAdmin: false }
          : { ...current, isAdmin: false });
      }
      setError(adminError(cause, "Det gick inte att spara innehållet."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(slide: Slide) {
    setSaving(true);
    setError("");
    try {
      const updated = await updateSlide(slide.id, slideInput(slide, !slide.isActive));
      setSlides((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      if (isAuthorizationError(cause)) {
        setViewer((current) => cause.status === 401
          ? { signedIn: false, email: null, isAdmin: false }
          : { ...current, isAdmin: false });
      }
      setError(adminError(cause, "Det gick inte att uppdatera innehållet."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(slide: Slide) {
    if (!window.confirm(`Ta bort ”${slide.title}” från kiosken? Åtgärden går inte att ångra.`)) return;
    setSaving(true);
    setError("");
    try {
      await deleteSlide(slide.id);
      setSlides((current) => current.filter((item) => item.id !== slide.id));
    } catch (cause) {
      if (isAuthorizationError(cause)) {
        setViewer((current) => cause.status === 401
          ? { signedIn: false, email: null, isAdmin: false }
          : { ...current, isAdmin: false });
      }
      setError(adminError(cause, "Det gick inte att ta bort innehållet."));
    } finally {
      setSaving(false);
    }
  }

  function openEditor(slide?: Slide) {
    setEditing(slide ?? null);
    setError("");
    setEditorOpen(true);
  }

  return <main className="admin-shell">
    <header className="admin-header">
      <a className="brand" href="/" aria-label="Till bildskärmen">
        <span className="brand-mark"><ScreenShare size={20} /></span>
        <span>HANDBOLLS<span>KIOSKEN</span></span>
      </a>
      <div className="admin-header-actions"><a className="admin-link" href="/">Visa kiosken <ArrowRight size={15} /></a>
        {viewer.signedIn && <button className="sign-out" onClick={signOut}><LogOut size={16} /> Logga ut</button>}</div>
    </header>

    <section className="admin-content">
      <div className="admin-intro"><span className="eyebrow">INNEHÅLLSHANTERING <span className="status-dot" /></span>
        <h1>Vad ska visas<br /><em>i hallen?</em></h1>
        <p>Lägg till bilder och länkar som visas på skärmen utanför planen.</p>
      </div>

      {error && <div className="notice" role="alert">{error}</div>}
      {loading ? <div className="admin-loading"><LoaderCircle className="spin" size={22} /> Hämtar innehåll…</div>
        : !viewer.isAdmin ? <section className="access-card">
          <span className="access-icon"><LogIn size={23} /></span>
          <div><h2>{viewer.signedIn ? "Du saknar behörighet" : "Logga in som administratör"}</h2>
            <p>{viewer.signedIn ? "Endast global administratör kan ändra vad som visas i kiosken." : "Logga in med ett konto som har lagts till som global administratör."}</p>
            {viewer.signedIn ? <span className="account-email">{viewer.email}</span> : <button className="button button-dark" onClick={signIn}><LogIn size={16} /> Logga in</button>}
          </div>
        </section>
          : <>
            <div className="content-toolbar"><div>            <span className="content-count">{slides.length}</span><span className="content-label">INLÄGG <small>•</small> {slides.filter((slide) => slide.isActive).length} AKTIVA</span></div>
              <button className="button button-dark" onClick={() => openEditor()}><Plus size={17} /> Lägg till innehåll</button></div>
            {slides.length ? <div className="content-list">{slides.map((slide, itemIndex) => <article className={`content-row${slide.isActive ? "" : " inactive"}`} key={slide.id}>
              <div className="content-number">{String(itemIndex + 1).padStart(2, "0")}</div>
              <div className="content-thumb">{slide.kind === "image" && slide.imageUrl ? <img src={slide.imageUrl} alt="" /> : <span><ExternalLink size={21} /></span>}</div>
              <div className="content-main"><div className="content-title-line"><h2>{slide.title}</h2><span className={slide.isActive ? "status-tag active" : "status-tag"}>{slide.isActive ? "Visas" : "Dold"}</span></div>
                <p>{slide.kind === "image" ? "Bild" : "Länk"} <span>·</span> {slide.durationSeconds} sekunder{slide.kind === "link" && slide.url ? <><span> · </span><a href={slide.url} target="_blank" rel="noreferrer">{slide.url}</a></> : null}</p></div>
              <div className="content-actions"><button className="icon-action" onClick={() => openEditor(slide)} disabled={saving} aria-label={`Redigera ${slide.title}`}><Pencil size={17} /></button>
                <button className="icon-action" onClick={() => void toggleActive(slide)} disabled={saving} aria-label={slide.isActive ? `Dölj ${slide.title}` : `Visa ${slide.title}`}>{slide.isActive ? <Pause size={17} /> : <Play size={17} />}</button>
                <button className="icon-action danger" onClick={() => void remove(slide)} disabled={saving} aria-label={`Ta bort ${slide.title}`}><Trash2 size={17} /></button></div>
            </article>)}</div>
              : <div className="admin-empty"><span className="empty-mark"><ImagePlus size={27} /></span><h2>Skärmen är redo för sitt första innehåll</h2><p>Ladda upp en bild eller lägg till en länk så visas den här.</p><button className="text-button" onClick={() => openEditor()}>Lägg till det första inlägget <ArrowRight size={15} /></button></div>}
          </>}
      <div className="admin-tip"><Check size={17} /><p>Endast global administratör kan ändra innehållet. Ändringar visas på skärmen inom en minut.</p></div>
    </section>
    <footer className="admin-footer"><a href="/">← Till bildskärmen</a><span>HANDBOLLSKIOSKEN · INNEHÅLLSHANTERING</span></footer>

    {editorOpen && <SlideEditor slide={editing} saving={saving} error={error} onClose={() => { if (!saving) setEditorOpen(false); }} onSubmit={(input) => void save(input)} />}
  </main>;
}

interface SlideEditorProps {
  slide: Slide | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: SlideInput) => void;
}

function SlideEditor({ slide, saving, error, onClose, onSubmit }: SlideEditorProps) {
  const [form, setForm] = useState(() => slide ? {
    title: slide.title,
    description: slide.description,
    kind: slide.kind,
    url: slide.url ?? "",
    durationSeconds: slide.durationSeconds,
    isActive: slide.isActive,
  } : blankForm);
  const [image, setImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setImageError("");
    try {
      const imageData = image ? { name: image.name, contentType: image.type, base64: await readImage(image) } : undefined;
      onSubmit({
        title: form.title,
        description: form.description,
        kind: form.kind,
        url: form.kind === "link" ? form.url.trim() : null,
        durationSeconds: Number(form.durationSeconds),
        isActive: form.isActive,
        ...(imageData ? { image: imageData } : {}),
      });
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : "Det gick inte att läsa bilden.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = saving || submitting;
  const hasImage = Boolean(image || (slide?.kind === "image" && slide.imageUrl));

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="modal-top"><div><span className="eyebrow">KIOSKENS BILDSPEL</span><h2 id="editor-title">{slide ? "Redigera innehåll" : "Lägg till innehåll"}</h2></div>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Stäng"><X size={19} /></button></div>
      <form onSubmit={(event) => void submit(event)} className="slide-form">
        <div className="form-kind" role="group" aria-label="Välj typ av innehåll">
          <button type="button" className={form.kind === "image" ? "kind-option selected" : "kind-option"} onClick={() => setForm({ ...form, kind: "image", url: "" })}><ImagePlus size={17} /> Bild</button>
          <button type="button" className={form.kind === "link" ? "kind-option selected" : "kind-option"} onClick={() => setForm({ ...form, kind: "link", url: slide?.kind === "link" ? slide.url ?? "" : "" })}><ExternalLink size={17} /> Länk</button>
        </div>

        {form.kind === "image" && <label className="upload-zone">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setImage(event.target.files?.[0] ?? null); setImageError(""); }} />
          <span className="upload-icon"><ImagePlus size={19} /></span>
          <strong>{image?.name ?? (slide?.kind === "image" ? "Välj en ny bild (valfritt)" : "Välj en bild att visa")}</strong>
          <small>JPG, PNG eller WebP · högst 8 MB{slide?.kind === "image" ? " · lämna tomt för att behålla nuvarande bild" : ""}</small>
        </label>}
        <label className="form-control"><span>Rubrik</span><input autoFocus required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Till exempel: Nästa hemmamatch" /></label>
        <label className="form-control"><span>Beskrivning <small>VALFRITT</small></span><textarea maxLength={500} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Lägg till information som ska synas på skärmen." /></label>
        {form.kind === "link" && <label className="form-control"><span>Länkadress</span><input type="url" required maxLength={2048} value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://exempel.se" /><small className="form-help">Webbsidan visas inbäddad i bildspelet. Vissa webbplatser blockerar inbäddning.</small></label>}
        <div className="editor-options">
          <label className="form-control"><span>Visningstid</span><select value={form.durationSeconds} onChange={(event) => setForm({ ...form, durationSeconds: Number(event.target.value) })}>{[10, 15, 20, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} sekunder</option>)}</select></label>
          <label className="toggle-control"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><span>Visa på skärmen</span></label>
        </div>
        {(imageError || error) && <div className="notice" role="alert">{imageError || error}</div>}
        <div className="form-actions"><button type="button" className="button button-light" onClick={onClose} disabled={busy}>Avbryt</button>
          <button type="submit" className="button button-dark" disabled={busy || (form.kind === "image" && !hasImage)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{slide ? "Spara ändringar" : "Lägg till i bildspelet"}</button></div>
      </form>
    </section>
  </div>;
}
