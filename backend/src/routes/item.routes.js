import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../utils/validators.js';
import { ITEM_CONDITIONS } from '../models/index.js';
import { postItem, getItemById, getItems, patchItem, removeItem } from '../controllers/item.controller.js';

const router = Router();

const itemBodySpec = {
  title: { type: 'string', required: true, min: 3, max: 200 },
  description: { type: 'string', max: 5000 },
  condition: { type: 'string', enum: ITEM_CONDITIONS }
};

// PATCH: every field optional (partial update)
const itemPatchSpec = Object.fromEntries(
  Object.entries(itemBodySpec).map(([k, v]) => [k, { ...v, required: false }])
);

const itemQuerySpec = {
  q: { type: 'string', max: 100 },
  sellerId: { type: 'integer', min: 1 },
  sort: { type: 'string', enum: ['createdAt', 'title'] },
  order: { type: 'string', enum: ['asc', 'desc'] },
  page: { type: 'integer', min: 1 },
  limit: { type: 'integer', min: 1, max: 100 }
};

router.get('/', validateQuery(itemQuerySpec), getItems);
router.get('/:id', getItemById);

router.post('/', requireAuth, validateBody(itemBodySpec), postItem);
router.patch('/:id', requireAuth, validateBody(itemPatchSpec), patchItem);
router.delete('/:id', requireAuth, removeItem);

export default router;