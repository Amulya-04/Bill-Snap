
import fs from 'fs'
import path from 'path'

const DATASET_PATH = 'D:/Bill Snap/dataset'
const API_URL = 'http://localhost:5000/api/analyze'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function readGroundTruth() {
  const csv = fs.readFileSync(
    path.join(DATASET_PATH, 'ground_truth.csv'),
    'utf8'
  )

  const lines = csv.trim().split(/\r?\n/)

  return lines.slice(1).map(line => {
    const [folder, image_name, is_bill, merchant, date,
      total, currency, category] = line.split(',')

    return {
      folder,
      image_name,
      isBill: is_bill.trim().toLowerCase() === 'yes',
      merchant: merchant?.trim() || '',
      date: date?.trim() || '',
      total: total?.trim() || '',
      currency: currency?.trim() || '',
      category: category?.trim() || ''
    }
  })
}

async function analyzeImage(record) {
  const imagePath = path.join(
    DATASET_PATH,
    record.folder,
    record.image_name
  )

  const imageBuffer = fs.readFileSync(imagePath)
  const blob = new Blob([imageBuffer], { type: 'image/jpeg' })

  const formData = new FormData()
  formData.append('image', blob, record.image_name)

  const response = await fetch(API_URL, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`)
  }

  return await response.json()
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

function compareField(actual, expected, field) {
  if (field === 'total') {
    return actual !== null &&
      actual !== '' &&
      Number(actual) === Number(expected)
  }

  return normalize(actual) === normalize(expected)
}

async function main() {
  const records = readGroundTruth()
  const results = []

  console.log(`Starting evaluation of ${records.length} images...\n`)

  for (let i = 0; i < records.length; i++) {
    const record = records[i]

    try {
      console.log(`[${i + 1}/${records.length}] ${record.image_name} (${record.folder})`)

      const prediction = await analyzeImage(record)

      const row = {
        image: `${record.folder}/${record.image_name}`,
        expectedBill: record.isBill,
        predictedBill: prediction.isBill === true,
        billCorrect: prediction.isBill === record.isBill,
        merchantCorrect: null,
        dateCorrect: null,
        totalCorrect: null,
        currencyCorrect: null,
        categoryCorrect: null,
        prediction
      }

      if (record.isBill && prediction.isBill === true) {
        row.merchantCorrect = compareField(
          prediction.merchant, record.merchant, 'merchant'
        )
        row.dateCorrect = compareField(
          prediction.date, record.date, 'date'
        )
        row.totalCorrect = compareField(
          prediction.total, record.total, 'total'
        )
        row.currencyCorrect = compareField(
          prediction.currency, record.currency, 'currency'
        )
        row.categoryCorrect = compareField(
          prediction.category, record.category, 'category'
        )
      }

      results.push(row)

      console.log(
        `  Expected: ${record.isBill ? 'Bill' : 'Non-bill'} | ` +
        `Predicted: ${prediction.isBill ? 'Bill' : 'Non-bill'}`
      )

      await sleep(2500)

    } catch (error) {
      console.error(`  Failed: ${error.message}`)

      results.push({
        image: `${record.folder}/${record.image_name}`,
        error: error.message
      })

      await sleep(5000)
    }
  }

  fs.writeFileSync(
    'evaluation-results.json',
    JSON.stringify(results, null, 2)
  )

  const successful = results.filter(r => r.prediction)
  const billResults = successful.filter(r => r.expectedBill)
  const detectedBills = billResults.filter(r => r.predictedBill)

  const accuracy = (items, field) => {
    const valid = items.filter(r => typeof r[field] === 'boolean')
    if (!valid.length) return 'N/A'
    const correct = valid.filter(r => r[field]).length
    return `${correct}/${valid.length} (${(correct / valid.length * 100).toFixed(2)}%)`
  }

  console.log('\n========== EVALUATION SUMMARY ==========')
  console.log(`Images processed: ${successful.length}/${records.length}`)
  console.log(`Bill detection accuracy: ${accuracy(successful, 'billCorrect')}`)
  console.log(`Merchant accuracy: ${accuracy(detectedBills, 'merchantCorrect')}`)
  console.log(`Date accuracy: ${accuracy(detectedBills, 'dateCorrect')}`)
  console.log(`Total accuracy: ${accuracy(detectedBills, 'totalCorrect')}`)
  console.log(`Currency accuracy: ${accuracy(detectedBills, 'currencyCorrect')}`)
  console.log(`Category accuracy: ${accuracy(detectedBills, 'categoryCorrect')}`)
  console.log('\nDetailed results saved to evaluation-results.json')
}

main()
