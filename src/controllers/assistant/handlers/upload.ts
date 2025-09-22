import { Request, Response } from 'express';

export const assistantUpload = async (req: Request, res: Response) => {
  try {
    res.status(400).json({ error: 'Upload non configuré' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur upload' });
  }
};