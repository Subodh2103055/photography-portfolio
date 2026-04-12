import { createServer as createViteServer } from 'vite';
import path from 'path';
import app from './api/index';

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    // Development: Use Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Development server running on http://localhost:${PORT}`);
    });
  } else {
    // Production: Serve static files from dist
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    // SPA fallback - only if not an API route
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    // Only listen if not on Vercel (Vercel handles listening)
    if (!process.env.VERCEL) {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Production server running on http://localhost:${PORT}`);
      });
    }
  }
}

// In Node.js, we need express for the production block
import express from 'express';

startServer();
