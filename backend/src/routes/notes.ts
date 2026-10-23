import { Router } from 'express';
import { NotesEngine } from '../engine/notesEngine';

export function notesRouter(notes: NotesEngine): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(notes.list());
  });

  router.post('/', async (req, res) => {
    const { languageInput, text } = req.body as { languageInput?: 'en' | 'ta'; text?: string };
    if (!text || (languageInput !== 'en' && languageInput !== 'ta')) {
      return res.status(400).json({ error: 'text and languageInput ("en"|"ta") are required' });
    }
    res.status(201).json(await notes.create(languageInput, text));
  });

  router.post('/:id/summarize', (req, res) => {
    try {
      res.json(notes.summarize(req.params.id));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/correct', async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
      res.json(await notes.correct(req.params.id, text));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return router;
}
