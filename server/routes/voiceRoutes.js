import { Router } from 'express';
import { confirmVoiceAction, processVoice } from '../controllers/voiceController.js';
import { AUDIO_FIELD, uploadAudio } from '../middleware/upload.js';

const router = Router();

/** multipart/form-data, one `audio` part. */
router.post('/process', uploadAudio, processVoice);

/** JSON body: { confirmationId } */
router.post('/confirm', confirmVoiceAction);

export { AUDIO_FIELD };
export default router;
