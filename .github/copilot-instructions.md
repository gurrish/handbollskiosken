# Copilot instructions

## Project overview

Handbollskiosken is a public slideshow for a display outside a handball court. The slideshow can show uploaded images and link cards. Only email addresses configured in `GLOBAL_ADMIN_EMAILS` may sign in and create, edit, activate/deactivate, or delete content.

The frontend is React, TypeScript, and Vite. The backend is an Azure Functions API integrated with Azure Static Web Apps. Slideshow metadata is stored in Azure Table Storage; uploaded images are stored in a private Azure Blob Storage container. Azure resources are defined in Bicep and deployed manually; GitHub Actions deploys the application and API using a Static Web Apps deployment token.

The website is for a Swedish audience. All visible interface text, accessibility labels, validation messages, and page metadata must be in Swedish. Do not add language switching or English UI copy.

## Project structure

- `src/App.tsx`: public kiosk slideshow and `/admin` content manager.
- `src/lib/api.ts`: typed browser API requests and development-only mock identity header.
- `src/types.ts`: frontend slide and viewer types.
- `src/index.css`: responsive kiosk and admin design.
- `api/src/domain.ts`: slide types and Zod request validation.
- `api/src/index.ts`: HTTP API, Static Web Apps identity parsing, and admin authorization.
- `api/src/repository.ts`: repository interface, in-memory development store, and Azure Table/Blob implementation.
- `public/staticwebapp.config.json`: Static Web Apps routing and API runtime configuration.
- `infra/`: Bicep entry point and resource modules.
- `.github/workflows/`: application build/deploy workflow.
- `README.md`: local setup, deployment, and API documentation.

## Code conventions

- Use TypeScript. Preserve strict type checking; avoid `any` and unsafe casts.
- Keep the frontend responsive, accessible, and suitable for a large TV display as well as phone and desktop admin use.
- Keep all user-facing copy in Swedish.
- Validate and constrain API inputs with Zod schemas in `api/src/domain.ts`. Return actionable client errors for invalid input and log unexpected failures.
- Keep persistence behind the `Repository` interface. Implement behavior for both `MemoryRepository` and `TableRepository`.
- Store slideshow metadata in the `KioskSlides` table and image bytes in the private `kiosk-content` Blob container, not in Table entities.
- Supported images are JPEG, PNG, or WebP, with a maximum size of 8 MB. Validate actual image signatures server-side; do not trust filenames or browser MIME types.
- Only active content appears on the public kiosk. All content changes and inactive-content reads must remain administrator-only.
- Keep API DTOs, frontend types, and README descriptions in sync when changing slide fields or endpoints.
- Update `README.md` for changes to local setup, domain behavior, authentication, infrastructure, required GitHub settings, routes, or deployment.

## Authentication and authorization

- Production identity must come from the trusted Static Web Apps `x-ms-client-principal` header. Never trust a client-supplied role, email, or identity for authorization.
- The API checks the authenticated email against the comma-separated `GLOBAL_ADMIN_EMAILS` server setting for every write operation.
- `x-dev-user-email` is for local development only. Accept it only when `DEV_AUTH=true` and `NODE_ENV` is not `production`; never enable it in Azure.
- Public active slideshow content and active images are intentionally readable. Creating, updating, deleting, listing inactive content, and reading inactive images require global admin authorization.
- Keep Blob Storage private. Never return a storage URL, key, or connection string to the browser.
- The integrated Static Web Apps managed Functions API uses the server-side `STORAGE_CONNECTION_STRING` configured by Bicep. Do not put storage credentials in frontend code, repository files, GitHub workflow arguments, or responses.
- Use Static Web Apps' built-in Microsoft Entra ID (`aad`) provider unless a complete custom provider setup is explicitly requested. Do not imply other identity providers are configured.

## Build and validation

- Frontend: `npm ci` then `npm run build` from the repository root.
- Functions API: `npm ci` then `npm run build` from `api/`.
- Infrastructure: `az bicep build --file infra/main.bicep`.
- For changes, run the smallest relevant checks and exercise changed API behavior where practical. Run `git diff --check` before finishing.
- Keep both root and API lockfiles committed when dependencies change. Do not install packages unless a dependency manifest changes or a validation command reports a missing package.
- Do not commit generated build output, local Functions settings, secrets, or Azure credentials.

## Infrastructure and deployment

- Define Azure resources in Bicep under `infra/` and reuse the existing modules where practical.
- Keep the Static Web Apps integrated Functions architecture. Azure infrastructure is deployed manually; do not add an infrastructure GitHub Actions workflow unless explicitly requested.
- The application deployment workflow uses the `SWA_DEPLOYMENT_TOKEN` GitHub secret. Keep its triggers and README instructions aligned with app build paths.
- Infrastructure is not deployed just because Bicep templates exist; state deployment status explicitly.
