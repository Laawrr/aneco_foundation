# OCR Server

This small Express server accepts an image upload at POST `/ocr` and returns extracted text using `tesseract.js`.

Quick start:

1. From the project root, install deps (if you haven't already):

   npm install express multer cors

2. Start the server:

   node server/index.js

3. Health check: GET http://localhost:3001/health

4. OCR endpoint: POST http://localhost:3001/ocr (form field name: `image`)

Notes:
- You can run this concurrently with the React dev server (see root `package.json` scripts).
- For development convenience, consider installing `nodemon` and `concurrently` and run `npm run dev` (this project adds a `dev` script for that purpose).