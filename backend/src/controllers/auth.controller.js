import { registerUser, authenticate } from '../services/auth.service.js';

export async function register(req, res, next) {
  try {
    const user = await registerUser(req.body);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const result = await authenticate(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}