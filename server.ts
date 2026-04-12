import express from 'express';
import { createServer as createViteServer } from 'vite';
import { v2 as cloudinary } from 'cloudinary';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// API Route to fetch photos from Cloudinary with pagination
app.get('/api/photos', async (req, res) => {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  const cursor = req.query.cursor as string;
  const limit = parseInt(req.query.limit as string) || 50;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ 
      error: 'Cloudinary configuration missing',
      details: `Missing: ${[!cloudName && 'Cloud Name', !apiKey && 'API Key', !apiSecret && 'API Secret'].filter(Boolean).join(', ')}`
    });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  try {
    const searchExpression = cloudinary.search
      .expression('resource_type:image')
      .sort_by('created_at', 'asc')
      .with_field('tags')
      .with_field('context')
      .max_results(limit);

    if (cursor) {
      searchExpression.next_cursor(cursor);
    }

    const result = await searchExpression.execute();

    const photos = result.resources.map((resource: any) => ({
      id: resource.public_id,
      title: resource.context?.caption || resource.public_id.split('/').pop() || 'Untitled',
      categories: resource.tags && resource.tags.length > 0 ? resource.tags : ['Uncategorized'],
      imageUrl: resource.secure_url
    }));

    res.json({
      photos,
      nextCursor: result.next_cursor,
      totalCount: result.total_count
    });
  } catch (error: any) {
    console.error('Cloudinary Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/photos/stats', async (req, res) => {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary configuration missing' });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  try {
    const result = await cloudinary.search
      .expression('resource_type:image')
      .max_results(1)
      .execute();
    
    res.json({ totalCount: result.total_count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/update-tag', express.json(), async (req, res) => {
  const { publicId, tag } = req.body;
  if (!publicId || !tag) return res.status(400).json({ error: 'Missing publicId or tag' });

  try {
    const result = await cloudinary.uploader.replace_tag(tag, [publicId]);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update tag', details: error.message });
  }
});

// Production static files
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  // SPA fallback - only if not an API route
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Development Vite server
async function startDevServer() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    const PORT = 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startDevServer();

export default app;
