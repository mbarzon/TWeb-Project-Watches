import { createItem, getItem, listItems, updateItem, deleteItem } from '../services/item.service.js';

export async function postItem(req, res, next) {
  try {
    const item = await createItem({
      sellerId: req.user.id,
      title: req.validated.title,
      description: req.validated.description ?? '',
      condition: req.validated.condition ?? 'GOOD'
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
}

export async function getItemById(req, res, next) {
  try {
    res.json({ item: await getItem(req.params.id) });
  } catch (err) {
    next(err);
  }
}

export async function getItems(req, res, next) {
  try {
    const { q, sellerId, sort, order, page, limit } = req.validated;
    res.json(await listItems({ q, sellerId, sort, order, page, limit }));
  } catch (err) {
    next(err);
  }
}

export async function patchItem(req, res, next) {
  try {
    const item = await updateItem(req.params.id, { user: req.user, changes: req.validated });
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

export async function removeItem(req, res, next) {
  try {
    res.json(await deleteItem(req.params.id, { user: req.user }));
  } catch (err) {
    next(err);
  }
}