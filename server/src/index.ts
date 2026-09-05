import 'dotenv/config';
import app, { CORS_ORIGIN } from './app.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

app.listen(PORT, () => {
  console.log(`docflow server listening on http://localhost:${PORT}`);
  console.log(`CORS allowing: ${CORS_ORIGIN}`);
});
