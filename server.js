const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_WA_NUMBER = 'whatsapp:+14155238886';

app.get('/', (req, res) => res.json({ status: 'DocSamajh backend is running' }));

async function analyzeDocument({ text, fileBase64, fileType, language = 'hindi' }) {
  const langMap = {
    hindi: 'Respond completely in Hindi (Devanagari script). Use simple everyday Hindi.',
    english: 'Respond in clear simple English. Avoid legal jargon.',
    hinglish: 'Respond in Hinglish — mix of Hindi and English as Indians speak daily.'
  };

  const systemPrompt = `You are DocSamajh, an AI that explains Indian legal and government documents to ordinary citizens.
${langMap[language] || langMap.hindi}
Respond ONLY with valid JSON. No markdown. No preamble.
{
  "docType": "document type",
  "urgency": "high|medium|low",
  "whatIsIt": "2-3 sentence explanation",
  "keyPoints": "2-3 important points",
  "actionSteps": ["step1","step2","step3"],
  "deadline": "any deadlines mentioned",
  "terms": "explain 2-3 key legal terms simply"
}`;

  let messageContent;
  if (fileBase64 && fileType === 'application/pdf') {
    messageContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } },
      { type: 'text', text: 'Analyze this document and provide JSON response.' }
    ];
  } else if (fileBase64 && fileType && fileType.startsWith('image/')) {
    messageContent = [
      { type: 'image', source: { type: 'base64', media_type: fileType, data: fileBase64 } },
      { type: 'text', text: 'Analyze this document and provide JSON response.' }
    ];
  } else {
    messageContent = `Analyze this document:\n\n${(text || '').substring(0, 8000)}`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: messageContent }]
  });

  const clean = response.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

function formatForWhatsApp(result) {
  const emoji = { high: '🔴 Urgent', medium: '🟡 Medium', low: '🟢 Normal' }[result.urgency] || '🟡';
  let msg = `✅ *DocSamajh Analysis*\n📄 *${result.docType}* — ${emoji}\n\n`;
  msg += `*Ye kya hai?*\n${result.whatIsIt}\n\n`;
  msg += `*Dhyan do:*\n${result.keyPoints}\n\n`;
  msg += `*Kya karna hai:*\n`;
  (result.actionSteps || []).forEach((s, i) => msg += `${i+1}. ${s}\n`);
  msg += `\n*Deadline:* ${result.deadline}\n\n`;
  msg += `*Key terms:*\n${result.terms}\n\n`;
  msg += `_More documents: docsamajh.vercel.app_ 🚀`;
  return msg;
}

// Web app endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { text, fileBase64, fileType, language } = req.body;
    const result = await analyzeDocument({ text, fileBase64, fileType, language });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WhatsApp webhook
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const numMedia = parseInt(req.body.NumMedia || '0');
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;

  async function reply(msg) {
    await twilioClient.messages.create({ from: TWILIO_WA_NUMBER, to: from, body: msg });
  }

  try {
    const lowerBody = body.toLowerCase();

    if (['hi','hello','hii','namaste','start','hey'].includes(lowerBody)) {
      await reply(
        `Namaste! 🙏 *DocSamajh* mein swagat hai!\n\n` +
        `Koi bhi Indian document samjhne ke liye:\n\n` +
        `📸 Document ki *photo bhejo*\n` +
        `📝 Ya document ka *text paste karo*\n\n` +
        `Main 10 seconds mein Hindi mein samjha dunga!\n\n` +
        `Income Tax • Court Notice • Loan Letter • Rent Agreement • Job Offer\n\n` +
        `_Pehle 3 documents FREE_ ✅`
      );
      return res.sendStatus(200);
    }

    if (numMedia > 0 && mediaUrl) {
      await reply('⏳ Document dekh raha hoon... 10-15 seconds...');
      const imgResponse = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN }
      });
      const fileBase64 = Buffer.from(imgResponse.data).toString('base64');
      const result = await analyzeDocument({ fileBase64, fileType: mediaType || 'image/jpeg' });
      await reply(formatForWhatsApp(result));
      return res.sendStatus(200);
    }

    if (body.length > 50) {
      await reply('⏳ Document padh raha hoon... 10-15 seconds...');
      const result = await analyzeDocument({ text: body });
      await reply(formatForWhatsApp(result));
      return res.sendStatus(200);
    }

    await reply(`Namaste! 😊 Document ki photo bhejo ya text paste karo.\n\n"Hi" bhejo for help.`);
    res.sendStatus(200);

  } catch (err) {
    console.error('WhatsApp error:', err.message);
    await reply('Maafi chahta hoon, kuch gadbad ho gayi. Dobara try karo. 🙏');
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
