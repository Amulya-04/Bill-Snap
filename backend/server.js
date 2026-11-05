
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import { GoogleGenAI } from '@google/genai'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
})

app.use(cors({
  origin: 'http://localhost:5173'
}))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'))
    }
    cb(null, true)
  }
})

app.get('/', (req, res) => {
  res.json({
    message: 'Bill Snap AI backend is running!'
  })
})

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Please upload an image.'
      })
    }

    const imageBase64 = req.file.buffer.toString('base64')

    const prompt = `
You are an intelligent bill and receipt detection system.

Analyze the provided image.

FIRST: Determine whether the image is a genuine purchase bill,
receipt, or utility bill.

Valid bills include:
- Grocery receipts
- Restaurant receipts
- Pharmacy receipts
- Shopping receipts
- Electricity and utility bills
- Handwritten purchase receipts

Invalid images include:
- Selfies and portraits
- Identity cards
- Screenshots without a genuine bill
- General documents
- Random objects
- Currency notes

If the image is NOT a bill, return:
{
  "isBill": false,
  "reason": "A polite explanation",
  "merchant": "",
  "date": "",
  "total": null,
  "currency": "",
  "category": "",
  "confidence": {
    "merchant": 0,
    "date": 0,
    "total": 0,
    "category": 0
  }
}

If it IS a bill, extract:
1. Merchant name
2. Transaction or bill date
3. Final payable total (not subtotal or tax)
4. Currency (INR, USD, etc.)
5. Category: Food, Groceries, Utilities,
   Healthcare, Shopping, Transport or Other.

For every field, estimate confidence between 0 and 1.

Important rules:
- Do not invent missing information.
- Use an empty string for unreadable text.
- Use null for an unreadable total.
- Return the date in YYYY-MM-DD format.
- Return the numeric amount without currency symbols.
- Distinguish the final payable amount from subtotal.
- If uncertain, use a lower confidence score.
- A receipt should not be rejected just because it is blurry,
  crumpled, handwritten or photographed at an angle.
- A screenshot of a receipt is not automatically invalid:
  if it clearly contains a genuine bill, classify it as a bill.
- Return ONLY valid JSON, without Markdown.

Use this exact structure:
{
  "isBill": true,
  "reason": "",
  "merchant": "",
  "date": "",
  "total": null,
  "currency": "",
  "category": "",
  "confidence": {
    "merchant": 0,
    "date": 0,
    "total": 0,
    "category": 0
  }
}
`

    let response

    // Retry Gemini requests if temporary server errors occur
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.5-flash-lite',
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: req.file.mimetype,
                    data: imageBase64
                  }
                }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json'
          }
        })

        break

      } catch (error) {
        console.error(
          `Gemini attempt ${attempt} failed:`,
          error.message
        )

        if (error.status !== 503 || attempt === 3) {
          throw error
        }

        await new Promise(resolve =>
          setTimeout(resolve, attempt * 3000)
        )
      }
    }

    if (!response) {
      throw new Error('Gemini could not process the image.')
    }

    // Convert Gemini response into a JavaScript object
    const result = JSON.parse(response.text)

    // Send extracted bill details to frontend
    return res.json(result)

  } catch (error) {
    console.error('Analysis error:', error)

    return res.status(500).json({
      error: 'Unable to analyze image. Please try again.'
    })
  }
})

// Handle upload and other backend errors
app.use((error, req, res, next) => {
  console.error(error.message)

  res.status(400).json({
    error: error.message
  })
})

app.listen(PORT, () => {
  console.log(
    `Bill Snap backend running on http://localhost:${PORT}`
  )
})
