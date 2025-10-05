const express = require('express');
const cors = require('cors');

const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const STRAINS_FILE = path.join(DATA_DIR, 'strains.json');
const MAPPINGS_FILE = path.join(DATA_DIR, 'mappings.json');

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load', file, e.message);
  }
  return fallback;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save', file, e.message);
  }
}

let strains = loadJson(STRAINS_FILE, []);

app.get('/strains', (req, res) => {
  res.json(strains);
});

app.get('/strains/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = strains.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.post('/strains', (req, res) => {
  const body = req.body || {};
  const id = strains.length ? Math.max(...strains.map((s) => s.id)) + 1 : 1;
  const entry = { id, ...body };
  strains.push(entry);
  saveJson(STRAINS_FILE, strains);
  res.status(201).json(entry);
});

app.delete('/strains/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = strains.findIndex((s) => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = strains.splice(idx, 1)[0];
  saveJson(STRAINS_FILE, strains);
  res.json({ deleted: removed.id });
});

app.get('/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const results = strains.filter((s) => s.name.toLowerCase().includes(q) || (s.effects || '').toLowerCase().includes(q));
  res.json(results);
});

// Mappings endpoints for manual disambiguation
// mappings functionality removed

const port = process.env.PORT || 5002;
app.listen(port, () => console.log(`Backend API listening on http://localhost:${port}`));
