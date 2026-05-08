/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useRef, useEffect, ReactNode, ChangeEvent, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileUp, 
  Printer, 
  Layout, 
  Sparkles, 
  History, 
  Download, 
  Trash2, 
  Check, 
  ChevronRight, 
  ChevronLeft,
  Loader2,
  FileText,
  Smartphone,
  ShieldCheck,
  Eye,
  Share2
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import * as pdfjs from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;
}

      // Initialization - Using Gemini for summary
const aiRef = { current: null as GoogleGenerativeAI | null };

function getAI() {
  if (!aiRef.current) {
    let apiKey: string | undefined;
    try {
      apiKey = process.env.GEMINI_API_KEY;
    } catch (e) {
      // process.env might not be defined in some browser environments
    }
    
    if (!apiKey || apiKey === "undefined" || apiKey === "") {
      throw new Error("AI Feature Unavailable: GEMINI_API_KEY is not set. Please add it to your environment variables to enable summaries.");
    }
    aiRef.current = new GoogleGenerativeAI(apiKey);
  }
  return aiRef.current;
}

type AppState = 'landing' | 'upload' | 'edit' | 'options' | 'processing' | 'result';

interface PDFPage {
  id: string; // Unique ID for each page across files
  fileIndex: number;
  pageNumber: number;
  dataUrl: string;
  selected: boolean;
  width: number;
  height: number;
}

interface ConversionRecord {
  id: string;
  name: string;
  date: string;
  pages: number;
}

export default function App() {
  const [state, setState] = useState<AppState>('landing');
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<PDFPage[]>([]);
  const [thumbLoading, setThumbLoading] = useState<Record<string, boolean>>({});
  const [layout, setLayout] = useState<number>(1);
  const [mode, setMode] = useState<'bw' | 'color'>('bw');
  const [showBorders, setShowBorders] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [processedPdfBlob, setProcessedPdfBlob] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<ConversionRecord[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [activeStep, setActiveStep] = useState(0);

  // Listen for install prompt
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      alert('To install this app on your device:\n\n1. Open this site in Chrome (Android) or Safari (iOS)\n2. Tap the browser Menu (⋮) or Share symbol (↑)\n3. Choose "Add to Home Screen" or "Install App"\n\nThis makes it work exactly like a native app!');
    }
  };

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dtp_history');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const saveToHistory = (name: string, pageCount: number) => {
    const newHistory = [
      { id: Date.now().toString(), name, date: new Date().toLocaleDateString(), pages: pageCount },
      ...history.slice(0, 9)
    ];
    setHistory(newHistory);
    localStorage.setItem('dtp_history', JSON.stringify(newHistory));
  };

  const deleteHistoryItem = (id: string) => {
    const newHistory = history.filter(item => item.id !== id);
    setHistory(newHistory);
    localStorage.setItem('dtp_history', JSON.stringify(newHistory));
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setPdfFiles(files);
    setIsProcessing(true);
    setState('processing');
    setProgress(5);

    try {
      const allLoadedPages: PDFPage[] = [];
      
      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        const file = files[fIdx];
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ 
          data: new Uint8Array(arrayBuffer)
        }).promise;

        for (let i = 1; i <= pdf.numPages; i++) {
          const pageId = `${fIdx}-${i}`;
          setThumbLoading(prev => ({ ...prev, [pageId]: true }));
          setProgress(Math.round(((fIdx * 100) / files.length) + ((i * 100) / (pdf.numPages * files.length))));
          
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 }); 
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { willReadFrequently: true })!;
          canvas.height = Math.round(viewport.height);
          canvas.width = Math.round(viewport.width);

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: context, viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          
          if (!dataUrl || dataUrl.length < 100) {
            console.warn(`Render quality issue for page ${i}`);
          }

          allLoadedPages.push({
            id: pageId,
            fileIndex: fIdx,
            pageNumber: i,
            dataUrl,
            selected: true,
            width: viewport.width,
            height: viewport.height
          });
          
          setThumbLoading(prev => ({ ...prev, [pageId]: false }));
          // Release memory
          canvas.width = 0;
          canvas.height = 0;
        }
      }

      setPages(allLoadedPages);
      setState('edit');
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load one or more PDFs. Please ensure they are valid PDF files.');
      setState('landing');
    } finally {
      setIsProcessing(false);
    }
  };

  const togglePage = (id: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  };

  const processPDF = async () => {
    setIsProcessing(true);
    setState('processing');

    try {
      const selectedPages = pages.filter(p => p.selected);
      if (selectedPages.length === 0) throw new Error('No pages selected');

      const outPdf = await PDFDocument.create();
      const pageWidth = 595.276; // A4 width in points
      const pageHeight = 841.89; // A4 height in points

      // Calculate grid dimensions
      let cols = 1, rows = 1;
      if (layout === 2) { cols = 1; rows = 2; }
      else if (layout === 3) { cols = 1; rows = 3; }
      else if (layout === 4) { cols = 2; rows = 2; }
      else if (layout === 6) { cols = 2; rows = 3; }
      else if (layout === 8) { cols = 2; rows = 4; }
      else if (layout === 10) { cols = 2; rows = 5; }

      const cellWidth = pageWidth / cols;
      const cellHeight = pageHeight / rows;

      let currentPage = outPdf.addPage([pageWidth, pageHeight]);
      let itemIndex = 0;

      // Cache pdf-lib documents to avoid re-reading files constantly
      const pdfDataBuffers = await Promise.all(pdfFiles.map(f => f.arrayBuffer()));
      
      // PRE-LOAD PDFJS Documents with copies of buffers to prevent "detached ArrayBuffer"
      const pdfjsDocs: Record<number, any> = {};
      for (let i = 0; i < pdfDataBuffers.length; i++) {
        const bufferCopy = new Uint8Array(pdfDataBuffers[i].slice(0));
        pdfjsDocs[i] = await pdfjs.getDocument({ data: bufferCopy }).promise;
      }

      // Parallel processing helper
      const processPage = async (pageInfo: typeof selectedPages[0], index: number) => {
        const pdfDoc = pdfjsDocs[pageInfo.fileIndex];
        const page = await pdfDoc.getPage(pageInfo.pageNumber);
        
        // Grid scale: 2.5 (High resolution for printing)
        const viewport = page.getViewport({ scale: 2.5 }); 
        
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        
        // IMPORTANT: Fill with white to prevent transparency issues causing blank/black pages
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        await page.render({ canvasContext: ctx, viewport }).promise;

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const len = data.length;

        // SMART BW LOGIC: Detect if page is mostly dark or mostly bright
        let darkPixels = 0;
        let totalSamples = 0;
        const marginX = Math.floor(canvas.width * 0.1); 
        const marginY = Math.floor(canvas.height * 0.1);
        
        for (let y = marginY; y < canvas.height - marginY; y += 40) {
          for (let x = marginX; x < canvas.width - marginX; x += 40) {
            const idx = (y * canvas.width + x) * 4;
            if (idx + 3 < len) {
              if ((data[idx] + data[idx+1] + data[idx+2]) / 3 < 100) darkPixels++;
              totalSamples++;
            }
          }
        }
        const isMostlyDark = totalSamples > 0 && (darkPixels / totalSamples) > 0.4;

        if (mode === 'bw') {
          for (let j = 0; j < len; j += 4) {
            const avg = (data[j] + data[j+1] + data[j+2]) / 3;
            let val = avg;
            if (isMostlyDark) {
              // Dark Background -> Invert (Ink Saving)
              val = 255 - avg;
            }
            // Clean up with threshold
            val = val < 160 ? 0 : 255;
            data[j] = val;
            data[j+1] = val;
            data[j+2] = val;
          }
        } else {
          // Color Mode: Preserve original colors exactly as requested by user
          // No inversion or artificial cleanup that changes original appearance
        }
        ctx.putImageData(imgData, 0, 0);
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.82); 
        
        // Robust Base64 to Uint8Array conversion for pdf-lib
        const base64Content = imgDataUrl.split(',')[1];
        if (!base64Content) throw new Error("Failed to generate image data for page " + index);
        
        const binStr = atob(base64Content);
        const bytes = new Uint8Array(binStr.length);
        for (let j = 0; j < binStr.length; j++) {
          bytes[j] = binStr.charCodeAt(j);
        }
        
        // Cleanup canvas memory
        canvas.width = 0;
        canvas.height = 0;
        
        return { bytes, index };
      };

      // Sequential processing to avoid memory/canvas context pressure
      for (let i = 0; i < selectedPages.length; i++) {
        setProgress(Math.round((i / selectedPages.length) * 100));
        
        // Brief pause to allow UI thread to breathe and avoid "Vite server connection lost"
        if (i % 3 === 0) await new Promise(r => setTimeout(r, 50));

        const pageInfo = selectedPages[i];
        const res = await processPage(pageInfo, i);

        if (itemIndex > 0 && itemIndex % (cols * rows) === 0) {
          currentPage = outPdf.addPage([pageWidth, pageHeight]);
        }

        const embeddedImg = await outPdf.embedJpg(res.bytes);
        const localIndex = itemIndex % (cols * rows);
        const colIndex = localIndex % cols;
        const rowIndex = Math.floor(localIndex / cols);

        const imgDims = embeddedImg.scale(1);
        const marginFactor = showBorders ? 0.92 : 0.95; 
        const scale = Math.min((cellWidth * marginFactor) / imgDims.width, (cellHeight * marginFactor) / imgDims.height);
        const drawWidth = imgDims.width * scale;
        const drawHeight = imgDims.height * scale;

        const x = colIndex * cellWidth + (cellWidth - drawWidth) / 2;
        const y = pageHeight - ((rowIndex + 1) * cellHeight) + (cellHeight - drawHeight) / 2;

        currentPage.drawImage(embeddedImg, {
          x,
          y,
          width: drawWidth,
          height: drawHeight,
        });

        if (showBorders) {
          currentPage.drawRectangle({
            x,
            y,
            width: drawWidth,
            height: drawHeight,
            borderColor: rgb(0.85, 0.85, 0.85),
            borderWidth: 0.5,
          });
        }

        itemIndex++;
      }

      const pdfBytes = await outPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      setProcessedPdfBlob(blob);
      saveToHistory(pdfFiles[0].name + (pdfFiles.length > 1 ? ` (+${pdfFiles.length - 1} more)` : ''), selectedPages.length);
      setState('result');
    } catch (error) {
      console.error('Processing error:', error);
      alert('Error during PDF conversion: ' + (error instanceof Error ? error.message : String(error)));
      setState('edit');
    } finally {
      setIsProcessing(false);
    }
  };

  const generateSummary = async () => {
    if (pdfFiles.length === 0) return;
    setIsProcessing(true);
    try {
      let fullText = "";
      
      for (const file of pdfFiles) {
        const pdfDoc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const maxPages = Math.min(pdfDoc.numPages, 8);
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
        }
        if (fullText.length > 18000) break;
      }

      const prompt = `Act as a senior student summarizing lecture notes for a friend. 
      Analyze the text below and create a summary.
      - USE SIMPLE, CONVERSATIONAL LANGUAGE.
      - HIGHLIGHT MAIN CONCEPTS IN 3-5 BULLET POINTS.
      - IDENTIFY IMPORTANT HIGHLIGHTS OR EXAM TIPS.
      - PREDICT 3 POSSIBLE EXAM QUESTIONS.
      - END WITH A "TL;DR" (2-SENTENCE SUMMARY).
      
      FILE CONTENT:
      ${fullText.slice(0, 15000)}`;

      const ai = getAI();
      // Using gemini-1.5-flash for maximum speed
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      setSummary(responseText || "Could not generate summary.");
    } catch (error) {
      console.error('Summary error:', error);
      setSummary("Error generating summary.");
    } finally {
      setIsProcessing(false);
    }
  };

  const processedPdfUrl = useMemo(() => {
    if (!processedPdfBlob) return '';
    return URL.createObjectURL(processedPdfBlob);
  }, [processedPdfBlob]);

  // Cleanup blob URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (processedPdfUrl) URL.revokeObjectURL(processedPdfUrl);
    };
  }, [processedPdfUrl]);

  const handleShare = async () => {
    const shareData = {
      title: 'Digital To Printable',
      text: '🚀 Just optimized my study notes using DigitalToPrintable! It converts dark slides to ink-saving white backgrounds and fits multiple slides on one page. Save ink, save paper! 📄✨',
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        toast.success('Shared successfully!');
      } else {
        await navigator.clipboard.writeText(`${shareData.text} \nTry it here: ${shareData.url}`);
        toast.success('Link copied to clipboard!');
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  const downloadProcessed = () => {
    if (!processedPdfUrl) return;
    const a = document.createElement('a');
    a.href = processedPdfUrl;
    a.download = `Converted_Notes_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Download started!');
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setState('landing')}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
              <Printer className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900 leading-none">DigitalToPrintable</h1>
              <p className="hidden text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:block mt-1">Smart Document Workflow</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden flex-col items-end text-xs sm:flex">
              <span className="font-bold text-emerald-600">Secure Storage</span>
              <span className="text-slate-400">Memory only, No uploads</span>
            </div>
            <button 
              onClick={() => setState('landing')}
              className="hidden items-center gap-2 text-sm font-medium text-slate-600 hover:text-indigo-600 sm:flex"
            >
              <History className="h-4 w-4" />
              History
            </button>
            <div className="h-6 w-[1px] bg-slate-200" />
            <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
               <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
               On-Device Processing
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          {state === 'landing' && (
            <motion.div 
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center py-12 text-center"
            >
              <div className="mb-6 flex animate-bounce-slow items-center justify-center rounded-3xl bg-indigo-600 shadow-xl shadow-indigo-100 h-24 w-24 border-4 border-white">
                <Printer className="h-12 w-12 text-white" />
              </div>
              <h2 className="mb-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
                Ink-Saving <span className="text-indigo-600">Smart-Board</span> <br /> Multi-Doc Converter
              </h2>
              <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-600">
                Upload one or multiple PDF slide decks. We'll transform dark classroom backgrounds into crisp white pages and arrange them to save up to 75% paper.
              </p>
              
              <div className="flex flex-wrap justify-center gap-4">
                <button 
                  onClick={() => setState('upload')}
                  className="group relative flex items-center gap-3 rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-bold text-white shadow-xl shadow-indigo-100 transition-all hover:-translate-y-1 hover:bg-indigo-700 active:scale-95"
                >
                  Start Conversion
                  <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </button>
                <button 
                  onClick={handleInstallApp}
                  className="flex items-center gap-3 rounded-2xl bg-white px-8 py-4 text-lg font-bold text-slate-700 shadow-lg border border-slate-100 transition-all hover:-translate-y-1 hover:bg-slate-50 active:scale-95"
                >
                  <Smartphone className="h-6 w-6 text-indigo-600" />
                  {deferredPrompt ? 'Install App' : 'Download App'}
                </button>
              </div>

              <div className="mt-20 grid grid-cols-1 gap-8 sm:grid-cols-3">
                <FeatureCard 
                  icon={<Smartphone className="h-6 w-6" />}
                  title="Mobile Ready"
                  desc="Works directly in your browser on any device."
                />
                <FeatureCard 
                  icon={<Layout className="h-6 w-6" />}
                  title="N-in-1 Layouts"
                  desc="2, 4, 6, 8, or 10 slides per page options."
                />
                <FeatureCard 
                  icon={<ShieldCheck className="h-6 w-6" />}
                  title="Private & Secure"
                  desc="Files are processed locally. Nothing is uploaded."
                />
              </div>

              {history.length > 0 && (
                <div className="mt-16 w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
                  <div className="mb-6 flex items-center gap-2">
                    <History className="h-5 w-5 text-indigo-600" />
                    <h3 className="font-bold">Recent Activity</h3>
                  </div>
                  <div className="space-y-4">
                    {history.map(item => (
                      <div key={item.id} className="group flex items-center justify-between border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg bg-slate-50 p-2 group-hover:bg-indigo-50 transition-colors">
                            <FileText className="h-5 w-5 text-slate-400 group-hover:text-indigo-600" />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold truncate max-w-[200px] sm:max-w-[400px]">{item.name}</p>
                            <p className="text-[10px] text-slate-400 uppercase font-medium">Converted {item.date} • {item.pages} slides</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHistoryItem(item.id);
                            }}
                            className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            title="Delete from history"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <Check className="h-4 w-4 text-green-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {state === 'upload' && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mx-auto max-w-xl rounded-3xl border-2 border-dashed border-slate-200 bg-white p-12 text-center shadow-lg"
            >
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <FileUp className="h-10 w-10" />
              </div>
              <h3 className="mb-2 text-xl font-bold">Select Class Notes</h3>
              <p className="mb-8 text-slate-500">Pick the PDF slide deck you want to convert.</p>
              
              <label className="flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl bg-indigo-600 py-4 font-bold text-white transition-colors hover:bg-indigo-700">
                <span>Choose PDF Files</span>
                <input type="file" accept="application/pdf" multiple className="hidden" onChange={handleFileUpload} />
              </label>
              
              <button 
                onClick={() => setState('landing')}
                className="mt-6 text-sm font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel and go back
              </button>
            </motion.div>
          )}

          {state === 'edit' && (
            <motion.div 
              key="edit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-2xl font-bold">Manage Pages</h3>
                  <p className="text-slate-500">Select slides from all {pdfFiles.length} uploaded files.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-400">
                    {pages.filter(p => p.selected).length} / {pages.length} selected
                  </span>
                  <button 
                    onClick={() => setState('options')}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 font-bold text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700"
                  >
                    Next Step
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {pages.map((page) => (
                  <div 
                    key={page.id}
                    onClick={() => togglePage(page.id)}
                    className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 transition-all duration-300 bg-white ${
                      page.selected ? 'border-indigo-600 shadow-md scale-[0.98]' : 'border-slate-100 opacity-50 grayscale'
                    }`}
                  >
                      <div className="relative aspect-video w-full overflow-hidden bg-slate-100 flex items-center justify-center p-2">
                        {thumbLoading[page.id] ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                            <span className="text-[10px] font-bold text-slate-400">Rendering...</span>
                          </div>
                        ) : (
                          <img 
                            src={page.dataUrl} 
                            alt={`Page ${page.pageNumber}`} 
                            className="h-full w-full object-contain shadow-sm" 
                          />
                        )}
                      </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 p-2 text-center text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                      File {page.fileIndex + 1} • Page {page.pageNumber}
                    </div>
                    {!page.selected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/20">
                         <Trash2 className="h-8 w-8 text-indigo-600" />
                      </div>
                    )}
                    {page.selected && (
                       <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md">
                          <Check className="h-4 w-4" />
                       </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {state === 'options' && (
            <motion.div 
              key="options"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-4xl space-y-12"
            >
              <div className="text-center">
                <h3 className="text-3xl font-bold">Print Configuration</h3>
                <p className="text-slate-500">Choose how you want your notes to be formatted.</p>
              </div>

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                {/* Mode Select */}
                <div className="space-y-4 rounded-3xl bg-white p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Eye className="h-5 w-5" />
                    <h4 className="font-bold">Output Style</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <OptionButton 
                      active={mode === 'bw'} 
                      onClick={() => setMode('bw')} 
                      label="B&W / Inverted" 
                      subtitle="Perfect for dark board"
                      icon={<div className="h-3 w-3 rounded-full border border-slate-300 bg-white" />}
                    />
                    <OptionButton 
                      active={mode === 'color'} 
                      onClick={() => setMode('color')} 
                      label="Color Balanced" 
                      subtitle="Fix theme only"
                      icon={<div className="h-3 w-3 rounded-full bg-gradient-to-tr from-indigo-500 to-rose-500" />}
                    />
                  </div>
                </div>

                {/* Border Select */}
                <div className="space-y-4 rounded-3xl bg-white p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Smartphone className="h-5 w-5" />
                    <h4 className="font-bold">Page Borders</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <OptionButton 
                      active={showBorders === true} 
                      onClick={() => setShowBorders(true)} 
                      label="Visible Borders" 
                      subtitle="Better separation"
                    />
                    <OptionButton 
                      active={showBorders === false} 
                      onClick={() => setShowBorders(false)} 
                      label="No Borders" 
                      subtitle="Clean & Seamless"
                    />
                  </div>
                </div>

                {/* Layout Select */}
                <div className="space-y-4 rounded-3xl bg-white p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <Layout className="h-5 w-5" />
                    <h4 className="font-bold">Grid Layout (A4)</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 4, 6, 8, 10].map(val => (
                      <button
                        key={val}
                        onClick={() => setLayout(val)}
                        className={`rounded-xl border-2 px-3 py-4 transition-all ${
                          layout === val ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <div className="mb-1 text-center text-lg font-bold">{val}-in-1</div>
                        <div className="text-center text-[10px] text-slate-400">Pages/A4</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <button 
                    onClick={processPDF}
                    className="flex scale-110 items-center justify-center gap-3 rounded-2xl bg-indigo-600 px-12 py-4 text-xl font-bold text-white shadow-xl shadow-indigo-100 transition-all hover:-translate-y-1 hover:bg-indigo-700 active:scale-95"
                  >
                    <Sparkles className="h-6 w-6" />
                    Build Document
                  </button>
                  <button 
                    onClick={generateSummary}
                    className="flex scale-110 items-center justify-center gap-3 rounded-2xl border-2 border-indigo-100 bg-white px-8 py-4 text-xl font-bold text-indigo-600 transition-all hover:-translate-y-1 hover:bg-indigo-50"
                  >
                    <Loader2 className={`h-6 w-6 ${isProcessing ? 'animate-spin' : ''}`} />
                    AI Summary
                  </button>
                </div>
                
                {summary && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }} 
                    animate={{ opacity: 1, scale: 1 }}
                    className="group relative w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl transition-all hover:shadow-indigo-200/50"
                  >
                    <div className="absolute top-0 left-0 w-2 h-full bg-indigo-600/20" />
                    <div className="notebook-lines p-10 pt-16">
                      <div className="mb-8 flex items-center justify-between">
                        <h4 className="flex items-center gap-3 font-hand text-3xl font-bold text-slate-800">
                          <Sparkles className="h-8 w-8 text-indigo-500" />
                          Handwritten Study Guide
                        </h4>
                        <button 
                          onClick={() => setSummary('')} 
                          className="rounded-full bg-slate-100 p-2 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                      
                      <div className="font-hand text-2xl tracking-wide text-slate-700">
                        {summary.split('\n').map((line, i) => (
                          <div key={i} className="min-h-[2.5rem]">
                             {line.startsWith('-') ? (
                               <span className="flex items-start gap-2">
                                 <span className="text-indigo-400 mt-1">●</span>
                                 <span>{line.substring(1)}</span>
                               </span>
                             ) : line}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-slate-50 px-10 py-6 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        <ShieldCheck className="h-4 w-4" />
                        Private & Local Summary
                      </div>
                      <button 
                        onClick={() => {
                          const blob = new Blob([summary], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'Study_Summary.txt';
                          a.click();
                        }}
                        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-95"
                      >
                        <Download className="h-4 w-4" />
                        Export Text
                      </button>
                    </div>
                  </motion.div>
                )}

                <button onClick={() => setState('edit')} className="text-sm font-medium text-slate-400 hover:text-slate-600">
                   Back to page selection
                </button>
              </div>
            </motion.div>
          )}

          {state === 'processing' && (
            <motion.div 
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="relative mb-12 flex h-40 w-40 items-center justify-center">
                <div className="absolute inset-0 animate-ping rounded-full bg-indigo-100 opacity-20"></div>
                <div className="absolute inset-4 animate-pulse rounded-full bg-indigo-50 opacity-40"></div>
                <div className="relative flex h-28 w-28 flex-col items-center justify-center rounded-3xl bg-white shadow-2xl shadow-indigo-100">
                   <div className="mb-2 text-2xl font-black text-indigo-600 font-mono">{progress}%</div>
                   <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-2xl font-bold tracking-tight">Optimizing Your Document</h3>
                <div className="flex flex-col items-center gap-2">
                  <LoadingStep label="Reading High-Res PDF" active={progress >= 0} />
                  <LoadingStep label="Removing Board Background" active={progress >= 30} />
                  <LoadingStep label="Arranging N-in-1 Grid" active={progress >= 60} />
                  <LoadingStep label="Finalizing On-Device Print-File" active={progress >= 90} />
                </div>
                
                {deferredPrompt && (
                  <button 
                    onClick={handleInstallApp}
                    className="mt-8 flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-xl transition-all hover:scale-105 active:scale-95"
                  >
                    <Smartphone className="h-4 w-4" />
                    Install Native App
                  </button>
                )}

                <p className="max-w-xs text-center text-sm text-slate-400 mt-6 font-medium">
                  Privacy Guaranteed: Your files never leave this device.
                </p>
              </div>
            </motion.div>
          )}

          {state === 'result' && (
            <motion.div 
              key="result"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mx-auto flex max-w-4xl flex-col items-center justify-center py-12 text-center"
            >
              <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600 shadow-lg shadow-green-50">
                <Check className="h-10 w-10" />
              </div>
              <h3 className="mb-2 text-3xl font-extrabold">Conversion Complete!</h3>
              <p className="mb-10 text-lg text-slate-500">Your notes are now optimized and saved locally.</p>
              
              {processedPdfUrl && (
                <div className="mb-10 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="bg-slate-50 px-4 py-3 flex items-center justify-between border-b border-slate-100">
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">PDF Document Ready</span>
                    <div className="flex gap-2">
                       <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                       <span className="h-2 w-2 rounded-full bg-green-300" />
                    </div>
                  </div>
                  {/* Robust preview using iframe as primary for better compatibility */}
                  <div className="relative h-[600px] w-full bg-slate-100 flex flex-col">
                    <iframe
                      src={`${processedPdfUrl}#toolbar=0&view=FitH`}
                      className="flex-1 w-full border-none"
                      title="PDF Preview"
                    />
                    
                    <div className="bg-white p-4 border-t border-slate-100 flex flex-col gap-3 sm:flex-row sm:justify-between items-center">
                       <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                          <Eye className="h-4 w-4 text-indigo-400" />
                          <span>Preview rendering...</span>
                       </div>
                       <button 
                         onClick={() => window.open(processedPdfUrl, '_blank')}
                         className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-4 py-2 rounded-lg transition-colors"
                       >
                         <Eye className="h-4 w-4" />
                         Open Full Preview
                       </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-4 sm:flex-row">
                <button 
                  onClick={downloadProcessed}
                  className="flex items-center gap-3 rounded-2xl bg-indigo-600 px-10 py-5 text-xl font-bold text-white shadow-xl shadow-indigo-100 transition-all hover:-translate-y-1 hover:bg-indigo-700 active:scale-95"
                >
                  <Download className="h-6 w-6" />
                  Download Saved PDF
                </button>
                <button 
                  onClick={handleShare}
                  className="flex items-center gap-3 rounded-2xl border-2 border-indigo-100 bg-white px-8 py-5 text-xl font-bold text-indigo-600 transition-all hover:-translate-y-1 hover:bg-indigo-50"
                >
                  <Share2 className="h-6 w-6" />
                  Share
                </button>
                <button 
                  onClick={() => {
                    setProcessedPdfBlob(null);
                    setPdfFiles([]);
                    setPages([]);
                    setSummary('');
                    setState('landing');
                  }}
                  className="flex items-center gap-3 rounded-2xl bg-slate-100 px-8 py-5 text-xl font-bold text-slate-600 transition-all hover:bg-slate-200"
                >
                  Start New
                </button>
              </div>
              <p className="mt-6 text-sm text-slate-400">Processing happened 100% on this device.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <Toaster position="bottom-right" />

      <footer className="mt-auto border-t border-slate-200 bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="text-left">
              <p className="text-sm font-black text-indigo-600 uppercase tracking-widest">DigitalToPrintable</p>
              <p className="text-xs text-slate-400">© 2026 - Processing 100% On-Device</p>
            </div>
            
              <div className="flex items-center gap-6">
              {deferredPrompt ? (
                <button 
                  onClick={handleInstallApp}
                  className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-100 transition-all border border-indigo-100 shadow-sm"
                >
                  <Smartphone className="h-4 w-4" />
                  Install Native App
                </button>
              ) : (
                <div className="group relative">
                  <button className="flex items-center gap-2 text-[10px] font-bold text-slate-300 transition-colors uppercase tracking-widest cursor-default">
                    <Smartphone className="h-3 w-3" />
                    PWA Ready
                  </button>
                  <div className="absolute bottom-full left-1/2 mb-2 w-48 -translate-x-1/2 rounded-lg bg-slate-800 p-2 text-[10px] text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 pointer-events-none">
                    To install: Tap "Share" or "Menu" in your browser & select "Add to Home Screen"
                  </div>
                </div>
              )}
                <div className="flex gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                <span>No Uploads</span>
                <span>Ink Safe</span>
                <span>A4 Ready</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
      <Toaster position="bottom-center" />
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: ReactNode, title: string, desc: string }) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm transition-all hover:shadow-md">
      <div className="mb-4 inline-flex rounded-2xl bg-indigo-50 p-4 text-indigo-600">
        {icon}
      </div>
      <h3 className="mb-2 font-bold text-slate-900">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-500">{desc}</p>
    </div>
  );
}

function LoadingStep({ label, active }: { label: string, active: boolean }) {
  return (
    <div className={`flex items-center gap-3 transition-all duration-500 ${active ? 'opacity-100' : 'opacity-30'}`}>
      <div className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-indigo-600 animate-pulse' : 'bg-slate-300'}`} />
      <span className={`text-xs font-bold uppercase tracking-widest ${active ? 'text-indigo-900' : 'text-slate-400'}`}>
        {label}
      </span>
    </div>
  );
}

function OptionButton({ active, onClick, label, subtitle, icon }: { active: boolean, onClick: () => void, label: string, subtitle: string, icon?: ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border-2 p-6 transition-all ${
        active ? 'border-indigo-600 bg-indigo-50 shadow-sm' : 'border-slate-100 hover:border-slate-300'
      }`}
    >
      {icon && (
        <div className="flex h-10 w-10 items-center justify-center">
          {icon}
        </div>
      )}
      <div className="text-center">
        <div className={`text-sm font-bold ${active ? 'text-indigo-900' : 'text-slate-600'}`}>{label}</div>
        <div className="text-[10px] text-slate-400 uppercase tracking-tight font-medium">{subtitle}</div>
      </div>
      {active && (
        <div className="absolute -right-2 -top-2 rounded-full bg-indigo-600 p-3 text-white">
           <Check className="h-3 w-3 translate-x-[-1px] translate-y-[1px]" />
        </div>
      )}
    </button>
  );
}
