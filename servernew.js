const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors()); // Allow browser to call this server
app.use(express.json({ limit: '20mb' })); // Allow large PDFs

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY // Set this in Railway dashboard
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'DocSamajh backend is running' });
});

// Main analyze endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { text, fileBase64, fileType, language, docType } = req.body;

    const langMap = {
      hindi: 'Respond completely in Hindi (Devanagari script). Use simple everyday Hindi.',
      english: 'Respond in clear simple English. Avoid legal jargon.',
      hinglish: 'Respond in Hinglish — mix of Hindi and English as Indians speak daily.'
    };

    const systemPrompt = `You are DocSamajh, an AI that explains Indian legal and government documents to ordinary citizens.
${langMap[language] || langMap.hindi}
${docType && docType !== 'auto' ? `This document is likely a: ${docType}.` : ''}

You MUST respond ONLY with a valid JSON object. No markdown, no code blocks, no preamble. Just raw JSON.

JSON structure:
{
  "docType": "short document type name",
  "urgency": "high" | "medium" | "low",
  "whatIsIt": "2-3 sentence plain explanation of what this document is",
  "keyPoints": "2-3 most important things to be aware of",
  "actionSteps": ["step 1", "step 2", "step 3", "step 4"],
  "deadline": "any dates or time limits mentioned, or Koi specific deadline nahi dikh raha",
  "terms": "explain 3-4 technical/legal terms used in simple words"
}`;

    let messageContent;

    if (fileBase64 && fileType === 'application/pdf') {
      // PDF document
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 }
        },
        { type: 'text', text: 'Analyze this document and provide the JSON response.' }
      ];
    } else if (fileBase64 && fileType.startsWith('image/')) {
      // Image
      messageContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: fileType, data: fileBase64 }
        },
        { type: 'text', text: 'Analyze this document and provide the JSON response.' }
      ];
    } else {
      // Plain text
      messageContent = `Here is the document to analyze:\n\n${text.substring(0, 8000)}`;
    }

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: messageContent }]
    });

    const raw = response.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    res.json({ success: true, result });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DocSamajh backend running on port ${PORT}`));
