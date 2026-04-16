import Tesseract from "tesseract.js";

export interface OcrResult {
  text: string;
  urls: string[];
  telegramUrls: string[];
  riskTerms: string[];
  walletAddresses: string[];
  confidence: number;
}

const RISK_TERMS = [
  "airdrop",
  "claim",
  "claim now",
  "connect wallet",
  "wallet connect",
  "free mint",
  "guaranteed returns",
  "100% profit",
  "risk-free",
  "limited time",
  "act now",
  "exclusive offer",
];

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const TELEGRAM_REGEX = /https?:\/\/t\.me\/[^\s<>"{}|\\^`\[\]]+/gi;
const WALLET_REGEX = /0x[a-fA-F0-9]{40}/g;

export async function runOcr(imageBuffer: Buffer): Promise<OcrResult> {
  const {
    data: { text, confidence },
  } = await Tesseract.recognize(imageBuffer, "eng+chi_sim");

  const lowerText = text.toLowerCase();
  const urls = text.match(URL_REGEX) || [];
  const telegramUrls = text.match(TELEGRAM_REGEX) || [];
  const walletAddresses = text.match(WALLET_REGEX) || [];
  const riskTerms = RISK_TERMS.filter((term) => lowerText.includes(term));

  return {
    text,
    urls,
    telegramUrls,
    riskTerms,
    walletAddresses,
    confidence,
  };
}
