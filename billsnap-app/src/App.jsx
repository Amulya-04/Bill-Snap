import { useEffect, useRef, useState } from 'react'
import { openDB } from 'idb'
import {
  Upload, Camera, Receipt, Loader2, AlertCircle, CheckCircle,
  X, FileText, Trash2, Eye, Sparkles, Wallet, CalendarDays,
  ArrowUpRight, ShieldCheck, ImagePlus, RefreshCw
} from 'lucide-react'

const dbPromise = openDB('BillSnapDB', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('bills')) {
      db.createObjectStore('bills', { keyPath: 'id' })
    }
  }
})

const API_URL = 'http://localhost:5000/api/analyze'

function App() {
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const [image, setImage] = useState(null)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [editedData, setEditedData] = useState({})
  const [error, setError] = useState('')
  const [selectedBill, setSelectedBill] = useState(null)
  const [savedBills, setSavedBills] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [savedImageUrl, setSavedImageUrl] = useState(null)

  useEffect(() => {
    let active = true
    dbPromise.then(db => db.getAll('bills')).then(bills => {
      if (active) setSavedBills(bills.sort((a, b) => b.id - a.id))
    }).catch(console.error)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedBill?.image) {
      setSavedImageUrl(null)
      return
    }
    const url = URL.createObjectURL(selectedBill.image)
    setSavedImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedBill])

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image)
    }
  }, [image])

  const handleImage = (selectedFile) => {
    if (!selectedFile) return
    if (!selectedFile.type.startsWith('image/')) {
      setError('Please select a valid image.')
      return
    }
    if (image) URL.revokeObjectURL(image)
    setFile(selectedFile)
    setImage(URL.createObjectURL(selectedFile))
    setResult(null)
    setEditedData({})
    setError('')
    setSaveMessage('')
  }

  const clearImage = () => {
    if (image) URL.revokeObjectURL(image)
    setImage(null)
    setFile(null)
    setResult(null)
    setEditedData({})
    setError('')
    setSaveMessage('')
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''
  }

  const analyzeBill = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    setSaveMessage('')
    try {
      const formData = new FormData()
      formData.append('image', file)
      const response = await fetch(API_URL, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Analysis failed.')
      setResult(data)
      if (data.isBill) {
        setEditedData({
          merchant: data.merchant || '',
          date: data.date || '',
          total: data.total ?? '',
          currency: data.currency || 'INR',
          category: data.category || 'Other'
        })
      }
    } catch (err) {
      setError(err.message || 'Unable to connect to backend. Check that the backend is running and internet is available.')
    } finally {
      setLoading(false)
    }
  }

  const updateField = (field, value) => {
    setEditedData(previous => ({ ...previous, [field]: value }))
  }

  const saveBill = async () => {
    if (editedData.total === '' || editedData.total === null || editedData.total === undefined) {
      setSaveMessage('Please enter the total amount.')
      return
    }
    if (!Number.isFinite(Number(editedData.total)) || Number(editedData.total) < 0) {
      setSaveMessage('Please enter a valid total amount.')
      return
    }
    try {
      setSaving(true)
      setSaveMessage('')
      const bill = {
        id: Date.now(),
        merchant: editedData.merchant.trim() || 'Unknown merchant',
        date: editedData.date,
        total: Number(editedData.total),
        currency: editedData.currency || 'INR',
        category: editedData.category || 'Other',
        image: file,
        savedAt: new Date().toISOString()
      }
      const db = await dbPromise
      await db.add('bills', bill)
      setSavedBills(previous => [bill, ...previous])
      setSaveMessage('Bill saved successfully!')
    } catch (err) {
      console.error('Save error:', err)
      setSaveMessage('Unable to save bill. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const deleteBill = async (id) => {
    if (!window.confirm('Are you sure you want to delete this bill?')) return
    try {
      const db = await dbPromise
      await db.delete('bills', id)
      setSavedBills(previous => previous.filter(bill => bill.id !== id))
      setSelectedBill(null)
    } catch (err) {
      console.error('Delete error:', err)
      window.alert('Unable to delete bill.')
    }
  }

  const formatAmount = (bill) => `${bill.currency || 'INR'} ${Number(bill.total || 0).toFixed(2)}`

  // Keep totals separate by currency; never add INR, USD, EUR, etc. together.
  const totalsByCurrency = savedBills.reduce((totals, bill) => {
    const currency = bill.currency || 'INR'
    totals[currency] = (totals[currency] || 0) + Number(bill.total || 0)
    return totals
  }, {})
  const totalSavedLabel = Object.entries(totalsByCurrency)
    .map(([currency, amount]) => `${currency} ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
    .join(' · ') || '0'

  // Category spending is grouped by currency so unlike currencies are never combined.
  const categorySpending = savedBills.reduce((groups, bill) => {
    const currency = bill.currency || 'INR'
    const category = bill.category || 'Other'
    if (!groups[currency]) groups[currency] = {}
    groups[currency][category] = (groups[currency][category] || 0) + Number(bill.total || 0)
    return groups
  }, {})

  const categoryColors = ['#b85d3e', '#71816a', '#c49a58', '#8b7965', '#6f897e', '#b77b62', '#8b8a70']
  const categoryCurrencyGroups = Object.entries(categorySpending).map(([currency, categories]) => {
    const entries = Object.entries(categories).sort((a, b) => b[1] - a[1])
    return {
      currency,
      entries,
      max: Math.max(...entries.map(([, amount]) => amount), 0),
      top: entries[0]
    }
  })

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Bill Snap home">
          <span className="brand-mark"><Receipt size={22} /></span>
          <span className="brand-copy"><strong>Bill Snap</strong><small>SMART EXPENSE MANAGER</small></span>
        </a>
        <div className="topbar-right">
          <span className="secure-label"><ShieldCheck size={15} /> Stored on this device</span>
          <div className="profile-avatar">BS</div>
        </div>
      </header>

      <main className="main-content" id="home">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={14} /> AI-POWERED RECEIPT SCANNER</span>
            <h1>Your bills,<br /><span>beautifully organized.</span></h1>
            <p>Snap a receipt, let AI read the details, and keep your expenses organized in one simple place.</p>
            <a className="hero-link" href="#upload">Scan a bill <ArrowUpRight size={16} /></a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-circle art-circle-one" />
            <div className="art-circle art-circle-two" />
            <div className="receipt-illustration">
              <div className="receipt-top"><Receipt size={27} /></div>
              <i /><i /><i className="short-line" />
              <div className="receipt-total"><span /> <b /></div>
              <div className="receipt-check"><CheckCircle size={27} /></div>
            </div>
            <div className="floating-chip"><Sparkles size={15} /> AI extracted</div>
          </div>
        </section>

        <section className="stats-grid" aria-label="Bill summary">
          <article className="stat-card">
            <span className="stat-icon blue"><Receipt size={19} /></span>
            <div><small>Saved bills</small><strong>{savedBills.length}</strong><span className="stat-caption">Receipts in your library</span></div>
          </article>
          <article className="stat-card">
            <span className="stat-icon green"><Wallet size={19} /></span>
            <div><small>Saved value by currency</small><strong className="stat-currency-total">{totalSavedLabel}</strong><span className="stat-caption">Separate totals · no currency conversion</span></div>
          </article>
          <article className="stat-card">
            <span className="stat-icon violet"><CalendarDays size={19} /></span>
            <div><small>Latest activity</small><strong>{savedBills.length ? new Date(savedBills[0].savedAt || savedBills[0].id).toLocaleDateString() : '—'}</strong><span className="stat-caption">Most recently saved bill</span></div>
          </article>
        </section>

        {savedBills.length > 0 && (
          <section className="category-section" aria-label="Category-wise expenditure">
            <div className="category-heading">
              <div>
                <span className="step-label">SPENDING BREAKDOWN</span>
                <h2>Where does your money go?</h2>
                <p>See how your saved bills are distributed across categories.</p>
              </div>
              <span className="category-heading-mark"><Wallet size={20} /></span>
            </div>

            <div className="category-currency-grid">
              {categoryCurrencyGroups.map(group => (
                <article className="category-card" key={group.currency}>
                  <div className="category-card-heading">
                    <div>
                      <small>EXPENDITURE IN</small>
                      <h3>{group.currency}</h3>
                    </div>
                    {group.top && (
                      <span className="top-category-label">
                        <ArrowUpRight size={13} /> Highest: {group.top[0]}
                      </span>
                    )}
                  </div>

                  <div className="category-bars">
                    {group.entries.map(([category, amount], index) => (
                      <div className="category-row" key={category}>
                        <div className="category-row-label">
                          <span>{category}</span>
                          <strong>
                            {group.currency} {amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </strong>
                        </div>
                        <div
                          className="category-track"
                          role="progressbar"
                          aria-label={`${category} expenditure`}
                          aria-valuemin="0"
                          aria-valuemax={group.max || 0}
                          aria-valuenow={amount}
                        >
                          <span
                            className="category-fill"
                            style={{
                              width: `${group.max > 0 ? (amount / group.max) * 100 : 0}%`,
                              background: categoryColors[index % categoryColors.length]
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="content-grid">
          <div className="primary-column">
            <section className="panel upload-panel" id="upload">
              <div className="section-title">
                <div><span className="step-label">01 / SCAN</span><h2>Upload a bill</h2><p>Choose a clear photo of your receipt to get started.</p></div>
                <span className="title-icon"><ImagePlus size={21} /></span>
              </div>
              <div className="upload-actions">
                <button className="upload-choice camera-choice" onClick={() => cameraRef.current?.click()}>
                  <span className="choice-icon"><Camera size={22} /></span>
                  <span><strong>Take a photo</strong><small>Open your device camera</small></span>
                  <ArrowUpRight className="choice-arrow" size={17} />
                </button>
                <button className="upload-choice" onClick={() => galleryRef.current?.click()}>
                  <span className="choice-icon"><Upload size={22} /></span>
                  <span><strong>Choose an image</strong><small>Upload from your device</small></span>
                  <ArrowUpRight className="choice-arrow" size={17} />
                </button>
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => handleImage(e.target.files?.[0])} />
              <input ref={galleryRef} type="file" accept="image/*" hidden onChange={e => handleImage(e.target.files?.[0])} />
              <div className="upload-footnote"><ShieldCheck size={14} /> Your saved bills stay in this browser on this device.</div>
            </section>

            {image && (
              <section className="panel preview-panel">
                <div className="section-title compact-title">
                  <div><span className="step-label">02 / PREVIEW</span><h2>Check your image</h2><p>Make sure the receipt is readable before analysis.</p></div>
                  <button className="text-button" onClick={clearImage}><X size={16} /> Remove</button>
                </div>
                <div className="preview-frame"><img src={image} alt="Selected bill preview" className="bill-preview" /></div>
                <button className="primary-button full-button" onClick={analyzeBill} disabled={loading}>
                  {loading ? <><Loader2 className="spin" size={18} /> Analyzing with AI...</> : <><Sparkles size={18} /> Analyze bill with AI</>}
                </button>
                {loading && <p className="loading-hint">Reading receipt details. This may take a few seconds.</p>}
              </section>
            )}

            {error && <div className="alert alert-error"><AlertCircle size={19} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}

            {result && (
              <section className="panel result-panel">
                {result.isBill ? (
                  <>
                    <div className="result-success"><span className="success-icon"><CheckCircle size={20} /></span><div><span className="step-label">03 / REVIEW</span><h2>Review extracted details</h2><p>Check the AI results and correct anything that needs editing.</p></div></div>
                    <div className="form-grid">
                      <label className="field-group"><span>Merchant name <small>(optional)</small></span><input value={editedData.merchant || ''} onChange={e => updateField('merchant', e.target.value)} placeholder="Enter merchant name" /></label>
                      <label className="field-group"><span>Bill date</span><input type="date" value={editedData.date || ''} onChange={e => updateField('date', e.target.value)} /></label>
                      <label className="field-group"><span>Total amount</span><input type="number" min="0" step="0.01" value={editedData.total ?? ''} onChange={e => updateField('total', e.target.value)} placeholder="0.00" /></label>
                      <label className="field-group"><span>Currency</span><select value={editedData.currency || 'INR'} onChange={e => updateField('currency', e.target.value)}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option></select></label>
                      <label className="field-group field-full"><span>Category</span><select value={editedData.category || 'Other'} onChange={e => updateField('category', e.target.value)}>{['Food', 'Groceries', 'Utilities', 'Healthcare', 'Shopping', 'Transport', 'Other'].map(category => <option key={category}>{category}</option>)}</select></label>
                    </div>
                    <div className="save-row"><div className="save-message" aria-live="polite">{saveMessage && <span className={saveMessage.includes('successfully') ? 'message-success' : 'message-error'}>{saveMessage}</span>}</div><button className="primary-button save-button" onClick={saveBill} disabled={saving}>{saving ? <><Loader2 className="spin" size={17} /> Saving...</> : <><CheckCircle size={17} /> Save bill</>}</button></div>
                  </>
                ) : (
                  <div className="alert alert-warning"><AlertCircle size={21} /><div><strong>This image wasn't recognized as a bill.</strong><p>{result.reason || 'Please upload a genuine bill or receipt image.'}</p><button className="text-button" onClick={clearImage}><RefreshCw size={15} /> Try another image</button></div></div>
                )}
              </section>
            )}
          </div>

          <aside className="side-column">
            <section className="panel tip-panel">
              <span className="tip-icon"><Sparkles size={19} /></span>
              <h3>Get the best scan</h3>
              <ul><li>Place the bill on a flat surface.</li><li>Keep all four edges visible.</li><li>Use good lighting and avoid shadows.</li><li>Make sure the total amount is readable.</li></ul>
            </section>
            <section className="privacy-card"><ShieldCheck size={20} /><div><strong>Private by design</strong><p>Your saved receipts are stored locally in this browser. AI analysis requires an internet connection.</p></div></section>
          </aside>
        </div>

        <section className="history-section" id="recent">
          <div className="history-heading"><div><span className="step-label">YOUR LIBRARY</span><h2>Recent bills <span className="count-pill">{savedBills.length}</span></h2><p>Your saved receipts, all in one place.</p></div></div>
          {savedBills.length === 0 ? (
            <div className="empty-state"><span className="empty-icon"><FileText size={27} /></span><h3>No bills saved yet</h3><p>Once you scan and save a bill, it will appear here for easy access.</p><a href="#upload" className="secondary-button">Scan your first bill <ArrowUpRight size={16} /></a></div>
          ) : (
            <div className="saved-bills-grid">{savedBills.map(bill => (
              <article className="saved-bill-card" key={bill.id}>
                <div className="saved-card-top"><span className="saved-category">{bill.category || 'Other'}</span><span className="saved-date">{bill.date || 'Date unavailable'}</span></div>
                <div className="saved-card-main"><span className="saved-receipt-icon"><Receipt size={20} /></span><div className="saved-info"><strong>{bill.merchant || 'Unknown merchant'}</strong><small>{bill.currency || 'INR'} receipt</small></div></div>
                <div className="saved-card-bottom"><strong>{formatAmount(bill)}</strong><div><button className="icon-button" title="View bill" onClick={() => setSelectedBill(bill)}><Eye size={17} /></button><button className="icon-button danger-icon" title="Delete bill" onClick={() => deleteBill(bill.id)}><Trash2 size={17} /></button></div></div>
              </article>
            ))}</div>
          )}
          <p className="currency-note">* Total saved amount adds numeric values as stored; bills in different currencies are not converted.</p>
        </section>
      </main>

      <footer className="footer"><span className="footer-brand"><Receipt size={16} /> Bill Snap</span><span>Simple. Smart. Organized.</span></footer>

      {selectedBill && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedBill(null) }}>
          <section className="bill-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-heading"><div><span className="step-label">SAVED RECEIPT</span><h2 id="modal-title">Bill details</h2></div><button className="icon-button" onClick={() => setSelectedBill(null)} aria-label="Close"><X size={19} /></button></div>
            {savedImageUrl && <div className="modal-image-wrap"><img src={savedImageUrl} alt="Saved receipt" /></div>}
            <div className="modal-details">
              <div><span>Merchant</span><strong>{selectedBill.merchant || 'Unknown merchant'}</strong></div>
              <div><span>Date</span><strong>{selectedBill.date || 'Not available'}</strong></div>
              <div><span>Total</span><strong>{formatAmount(selectedBill)}</strong></div>
              <div><span>Category</span><strong>{selectedBill.category || 'Other'}</strong></div>
            </div>
            <button className="delete-modal-button" onClick={() => deleteBill(selectedBill.id)}><Trash2 size={16} /> Delete this bill</button>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
