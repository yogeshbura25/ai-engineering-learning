import express from 'express';
import dotenv from 'dotenv';
import router from './src/routes/index.js';
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('AI Engineering Learning Server is running!');
});

app.use('/api', router);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

