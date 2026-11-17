# Stellar Drift

Browser-based space flight simulator using the imported Three.js, TypeScript, and Vite stack. Keep the existing project structure.

## Run on Replit

- Dependencies are installed with npm and tracked in `package-lock.json`.
- Use the **Run** button to start the **Start application** workflow (`npm run dev`).
- Vite serves the app on `0.0.0.0:5000`, mapped to the web preview.
- The game requires a desktop browser with WebGL2. Press the start button on the opening screen to play.
- No API keys, backend, or database are required. Careers are saved in browser storage; use the game's export/import controls to move a career between browsers or origins.

## Checks and build

- `npm run build` checks TypeScript and creates the static site in `dist/`.
- `npm run preview` serves that build on port 5000; stop the development workflow before using it.
- The imported static publishing settings build with `npm run build` and serve `dist/`.
