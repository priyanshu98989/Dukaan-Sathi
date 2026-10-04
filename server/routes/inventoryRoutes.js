import { Router } from 'express';
import { getDashboard, getInventory } from '../controllers/inventoryController.js';

const router = Router();

router.get('/inventory', getInventory);
router.get('/dashboard', getDashboard);

export default router;
