import { Router } from 'express';
import {
  getDashboard,
  getInventory,
  postItem,
  putItem,
  removeItem,
} from '../controllers/inventoryController.js';

const router = Router();

router.get('/inventory', getInventory);
router.get('/dashboard', getDashboard);

// Add / edit / delete. Mounted here so they inherit the router-level auth gate
// and the read limiter from routes/index.js - the same as every other shop route.
router.post('/items', postItem);
router.put('/items/:id', putItem);
router.delete('/items/:id', removeItem);

export default router;
