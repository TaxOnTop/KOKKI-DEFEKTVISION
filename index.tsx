
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import { 
  Activity, 
  AlertTriangle, 
  Camera, 
  Cpu, 
  Database, 
  Eye, 
  LayoutDashboard, 
  RefreshCcw, 
  ShieldCheck, 
  Upload,
  Terminal,
  Check,
  Plus,
  Target,
  Scan,
  Info
} from 'lucide-react';

// --- Types ---
type SensorData = {
  temp: number;
  pressure: number;
  cycleTime: number;
  vacuum: number;
  timestamp: string;
};

type BoundingBox = {
  label: string;
  ymin: number; 
  xmin: number;
  ymax: number;
  xmax: number;
};

type AnalysisResult = {
  status: 'CLEAN' | 'DEFECT_DETECTED' | 'WARNING';
  itemCount: number;
  defectCount: number;
  defects: { type: string; count: number }[];
  defectBoxes: BoundingBox[];
  summary: string;
};

type TrainingSample = {
  id: string;
  image: string;
  sensors: SensorData;
  label: string;
  timestamp: string;
};

const NOMINAL_VALUES = { temp: 650, pressure: 820, cycleTime: 42, vacuum: 98 };

const CastVisionApp = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sensors, setSensors] = useState<SensorData>({
    temp: NOMINAL_VALUES.temp,
    pressure: NOMINAL_VALUES.pressure,
    cycleTime: NOMINAL_VALUES.cycleTime,
    vacuum: NOMINAL_VALUES.vacuum,
    timestamp: new Date().toLocaleTimeString()
  });
  const [sensorHistory, setSensorHistory] = useState<SensorData[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [trainingData, setTrainingData] = useState<TrainingSample[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setSensors(prev => {
        const newData = {
          temp: prev.temp + (Math.random() - 0.5) * 4,
          pressure: prev.pressure + (Math.random() - 0.5) * 10,
          cycleTime: Math.max(38, Math.min(48, prev.cycleTime + (Math.random() - 0.5))),
          vacuum: Math.max(90, Math.min(100, prev.vacuum + (Math.random() - 0.5))),
          timestamp: new Date().toLocaleTimeString()
        };
        setSensorHistory(h => [...h.slice(-19), newData]);
        return newData;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleManualFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setCapturedImage(dataUrl);
      setIsCapturing(false);
      setAnalysis(null);
      runAnalysis(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCapturing(true);
        setCapturedImage(null);
        setAnalysis(null);
      }
    } catch (err) {
      console.error("Camera access failed", err);
    }
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
        setCapturedImage(dataUrl);
        stopCamera();
        runAnalysis(dataUrl);
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setIsCapturing(false);
    }
  };

  const runAnalysis = async (imageDataUrl: string) => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Metrology Mode: Rapid Surface Audit.
        Instructions: 
        1. Count discrete metal parts (itemCount).
        2. Count individual defects (defectCount): Porosity, Cold Shut, Flash, Cracks.
        3. Provide [ymin, xmin, ymax, xmax] normalized boxes (0-1000). 
        Strict Accuracy: Ignore reflections and oil.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { data: imageDataUrl.split(',')[1], mimeType: 'image/jpeg' } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING },
              itemCount: { type: Type.INTEGER },
              defectCount: { type: Type.INTEGER },
              defects: { 
                type: Type.ARRAY, 
                items: { 
                  type: Type.OBJECT,
                  properties: { type: { type: Type.STRING }, count: { type: Type.INTEGER } }
                } 
              },
              summary: { type: Type.STRING },
              defectBoxes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    ymin: { type: Type.NUMBER },
                    xmin: { type: Type.NUMBER },
                    ymax: { type: Type.NUMBER },
                    xmax: { type: Type.NUMBER }
                  }
                }
              }
            },
            required: ["status", "itemCount", "defectCount", "defects", "defectBoxes"]
          }
        }
      });

      const rawResult = JSON.parse(response.text || '{}');
      setAnalysis(rawResult);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addToTrainingSet = () => {
    if (!analysis || !capturedImage) return;
    const sample: TrainingSample = {
      id: `SAMPLE_${Date.now()}`,
      image: capturedImage,
      sensors: { ...sensors },
      label: analysis.status,
      timestamp: new Date().toISOString()
    };
    setTrainingData(prev => [sample, ...prev]);
    setAnalysis(null);
    setCapturedImage(null);
  };

  return (
    <div className="flex h-screen w-full bg-[#050507] text-zinc-100 font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleManualFile(file);
        e.target.value = '';
      }} />

      {/* Sidebar - Compact */}
      <nav className="w-16 lg:w-64 bg-zinc-950 border-r border-zinc-900 flex flex-col p-4 z-20">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="bg-blue-600 p-2 rounded-lg"><Scan className="w-5 h-5" /></div>
          <h1 className="font-black text-sm hidden lg:block uppercase tracking-tighter">CastVision <span className="text-blue-500">Fast</span></h1>
        </div>
        <div className="space-y-1 flex-grow">
          <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard />} label="Audit" />
          <NavItem active={activeTab === 'training'} onClick={() => setActiveTab('training')} icon={<Database />} label="Archive" />
          <NavItem active={activeTab === 'dev'} onClick={() => setActiveTab('dev')} icon={<Terminal />} label="System" />
        </div>
      </nav>

      <main className="flex-grow flex flex-col overflow-hidden relative">
        <header className="h-14 border-b border-zinc-900 flex items-center justify-between px-6 bg-zinc-950/80 backdrop-blur-xl z-20">
          <div className="flex items-center gap-4 text-zinc-500">
             <ShieldCheck className={`w-4 h-4 ${analysis?.status === 'CLEAN' ? 'text-emerald-500' : 'text-zinc-600'}`} />
             <span className="text-[10px] font-black uppercase tracking-[0.2em]">Metrology Pass // 0.1s Latency Target</span>
          </div>
          <div className="flex items-center gap-4">
             <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
             <span className="text-[9px] font-bold text-zinc-500 mono uppercase tracking-widest">Inference Ready</span>
          </div>
        </header>

        <div className="flex-grow p-6 overflow-y-auto custom-scrollbar">
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-12 gap-6 max-w-7xl mx-auto animate-in fade-in duration-500">
              {/* Stats */}
              <div className="col-span-12 lg:col-span-3 space-y-4">
                <SensorCard label="Temp" value={sensors.temp.toFixed(0)} unit="°C" color="blue" />
                <SensorCard label="Pressure" value={sensors.pressure.toFixed(0)} unit="bar" color="emerald" />
                
                <div className="glass p-5 rounded-3xl border-zinc-800">
                  <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-4 flex items-center justify-between">Audit Scoreboard <Activity className="w-3 h-3 text-blue-500" /></h3>
                  
                  {analysis ? (
                    <div className="space-y-5 animate-in slide-in-from-top-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-zinc-900/50 p-3 rounded-2xl border border-zinc-800 flex flex-col items-center">
                          <span className="text-2xl font-black text-white">{analysis.itemCount}</span>
                          <span className="text-[8px] text-zinc-500 font-bold uppercase mt-1">Parts</span>
                        </div>
                        <div className="bg-zinc-900/50 p-3 rounded-2xl border border-zinc-800 flex flex-col items-center">
                          <span className={`text-2xl font-black ${analysis.defectCount > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{analysis.defectCount}</span>
                          <span className="text-[8px] text-zinc-500 font-bold uppercase mt-1">Defects</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {analysis.defects.map((d, i) => (
                          <div key={i} className="flex items-center justify-between text-[10px] bg-zinc-900/40 px-3 py-2 rounded-xl border border-zinc-800/50">
                            <span className="font-bold text-zinc-400 uppercase flex items-center gap-2"><AlertTriangle className="w-2.5 h-2.5" /> {d.type}</span>
                            <span className={`font-black ${d.count > 0 ? 'text-red-400' : 'text-zinc-600'}`}>{d.count}</span>
                          </div>
                        ))}
                      </div>
                      
                      <button onClick={addToTrainingSet} className="w-full bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border border-blue-500/20">Commit Result</button>
                    </div>
                  ) : (
                    <div className="py-8 flex flex-col items-center justify-center opacity-20">
                      <Target className="w-8 h-8 text-zinc-400 mb-2" />
                      <p className="text-[8px] text-zinc-500 uppercase tracking-widest font-black">Waiting for Data</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Viewport - Fixed for Bounding Box Accuracy */}
              <div className="col-span-12 lg:col-span-9 space-y-6">
                <div className="glass rounded-[2.5rem] overflow-hidden relative bg-black border border-zinc-900 shadow-2xl flex items-center justify-center min-h-[500px]">
                  {isCapturing ? (
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  ) : capturedImage ? (
                    <div className="relative inline-block">
                       <img src={capturedImage} className="block max-w-full max-h-[70vh] object-contain" alt="Scan" />
                       
                       {/* Bounding Boxes - Rendered 1:1 against the image container */}
                       {analysis?.defectBoxes?.map((box, i) => (
                          <div key={i} className="absolute border-2 border-red-500 bg-red-500/10 shadow-[0_0_10px_rgba(239,68,68,0.3)] transition-all z-20 pointer-events-none" style={{
                             top: `${box.ymin / 10}%`,
                             left: `${box.xmin / 10}%`,
                             width: `${(box.xmax - box.xmin) / 10}%`,
                             height: `${(box.ymax - box.ymin) / 10}%`,
                          }}>
                            <div className="absolute -top-5 left-0 bg-red-600 text-[8px] px-1.5 py-0.5 text-white font-black uppercase rounded-sm">
                              {box.label}
                            </div>
                          </div>
                       ))}
                    </div>
                  ) : (
                    <div onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center gap-6 cursor-pointer group p-12">
                        <div className="p-10 bg-zinc-950 rounded-full border border-zinc-900 shadow-inner group-hover:scale-105 transition-transform">
                          <Upload className="w-12 h-12 opacity-30 text-blue-500" />
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Fast Metrology Feed</p>
                    </div>
                  )}

                  {loading && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center gap-4 z-50">
                      <RefreshCcw className="w-10 h-10 animate-spin text-blue-500" />
                      <p className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-400">Classifying...</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-4">
                  {!isCapturing && !capturedImage && (
                    <>
                      <button onClick={startCamera} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 shadow-xl shadow-blue-600/20"><Eye className="w-5 h-5" /> Live Optics</button>
                      <button onClick={() => fileInputRef.current?.click()} className="bg-zinc-900 hover:bg-zinc-800 text-zinc-300 px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 border border-zinc-800 transition-all"><Upload className="w-5 h-5" /> Import</button>
                    </>
                  )}
                  {isCapturing && (
                    <button onClick={captureImage} className="bg-white text-black px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 shadow-2xl active:scale-95 transition-transform">
                      <Camera className="w-5 h-5" /> Capture Frame
                    </button>
                  )}
                  {capturedImage && !loading && (
                    <>
                      <button onClick={addToTrainingSet} className="bg-emerald-600 hover:bg-emerald-500 text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3 shadow-xl shadow-emerald-600/20"><Check className="w-5 h-5" /> Accept Audit</button>
                      <button onClick={() => {setCapturedImage(null); setAnalysis(null);}} className="bg-zinc-900 hover:bg-zinc-800 text-zinc-400 px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-zinc-800 transition-all">Discard</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'training' && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in">
               <div className="flex justify-between items-end">
                  <h2 className="text-2xl font-black uppercase tracking-tighter">Audit Archive</h2>
                  <span className="text-[10px] font-bold text-zinc-500">{trainingData.length} SAMPLES RECORDED</span>
               </div>
               <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  {trainingData.map(sample => (
                    <div key={sample.id} className="glass rounded-2xl overflow-hidden border border-zinc-900 relative aspect-square">
                       <img src={sample.image} className="w-full h-full object-cover opacity-60 hover:opacity-100 transition-opacity" />
                       <div className="absolute top-2 left-2">
                          <span className={`text-[7px] px-1.5 py-0.5 rounded-md font-black uppercase ${sample.label === 'CLEAN' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'}`}>{sample.label}</span>
                       </div>
                    </div>
                  ))}
               </div>
            </div>
          )}
        </div>
      </main>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

// --- Sub-components ---

const NavItem = ({ active, icon, label, onClick }: any) => (
  <button onClick={onClick} className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 group ${active ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/30' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'}`}>
    <div className={`${active ? 'scale-110' : 'group-hover:text-blue-400'} transition-all`}>
      {React.cloneElement(icon, { size: 18, strokeWidth: active ? 3 : 2 })}
    </div>
    <span className="font-black text-[10px] hidden lg:block tracking-widest uppercase">{label}</span>
  </button>
);

const SensorCard = ({ label, value, unit, status, color }: any) => {
  const borderColors: any = { blue: 'border-blue-500/20', emerald: 'border-emerald-500/20' };
  return (
    <div className={`glass p-4 rounded-2xl border ${borderColors[color]} shadow-lg relative overflow-hidden group`}>
      <div className="flex justify-between items-start mb-2 relative z-10">
        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{label}</p>
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      </div>
      <div className="flex items-baseline gap-1 relative z-10">
        <span className="text-2xl font-black mono text-white tracking-tighter">{value}</span>
        <span className="text-zinc-600 text-[8px] uppercase font-black">{unit}</span>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<CastVisionApp />);
