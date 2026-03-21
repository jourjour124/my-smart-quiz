import React, { useState, useEffect } from 'react';
import { Upload, Trash2, FileText, Plus, X, AlertCircle, CheckCircle } from 'lucide-react';
import { Subject, FileMetadata } from '../types';
import { SUBJECTS } from '../constants';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function FileManager() {
  const [selectedSubject, setSelectedSubject] = useState<Subject>('Chinese');
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFiles(data);
    } catch (e) {
      console.error("Failed to fetch files", e);
      setError("无法加载文件列表");
    }
  };

  const processUpload = async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0) return;

    setIsUploading(true);
    setError(null);
    setSuccessMessage(null);

    const formData = new FormData();
    formData.append('subject', selectedSubject);
    Array.from(fileList).forEach(file => {
      formData.append('files', file);
    });

    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");
      
      setFiles(prev => [...prev, ...data]);
      setSuccessMessage(`成功上传 ${data.length} 个文件！题库已更新。`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      console.error("Upload error", e);
      setError(e.message || "上传失败，请重试");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processUpload(e.target.files);
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processUpload(e.dataTransfer.files);
    }
  };

  const deleteFile = async (id: string) => {
    try {
      const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setFiles(files.filter(f => f.id !== id));
      }
    } catch (e) {
      console.error("Delete error", e);
      setError("删除失败");
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <header className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">题库管理</h2>
          <p className="text-[#141414]/60 text-sm md:text-base">上传并管理各学科的学习资料</p>
        </div>
        
        <div className="flex overflow-x-auto pb-2 -mx-6 px-6 md:mx-0 md:px-0 md:pb-0 gap-2 scrollbar-hide">
          <div className="flex p-1 bg-[#141414]/5 rounded-xl whitespace-nowrap">
            {SUBJECTS.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSubject(s.id)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  selectedSubject === s.id ? "bg-white shadow-sm text-[#141414]" : "text-[#141414]/40 hover:text-[#141414]"
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 border border-red-100">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-green-50 text-green-600 rounded-2xl flex items-center gap-3 border border-green-100">
          <CheckCircle size={20} />
          <p className="text-sm font-medium">{successMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
        {/* Upload Area */}
        <div className="md:col-span-1">
          <label 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "group relative flex flex-col items-center justify-center h-48 md:h-64 border-2 border-dashed rounded-3xl bg-white transition-all cursor-pointer overflow-hidden",
              isDragging ? "border-[#141414] bg-[#141414]/5 scale-[0.98]" : "border-[#141414]/10 hover:border-[#141414]/20 hover:bg-[#141414]/5"
            )}
          >
            <input 
              type="file" 
              multiple 
              className="hidden" 
              onChange={handleFileChange}
              accept=".pdf,.ppt,.pptx,.doc,.docx,.jpg,.png,.xlsx,.xls,.txt"
            />
            <div className="flex flex-col items-center gap-3 md:gap-4 text-center p-6">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-[#141414]/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Upload className="text-[#141414]/60 w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <p className="font-bold text-sm">点击或拖拽上传</p>
                <p className="text-[10px] md:text-xs opacity-40 mt-1">支持 PDF, Word, PPT, 图片, Excel</p>
              </div>
            </div>
            {isUploading && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-[#141414] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </label>
        </div>

        {/* File List */}
        <div className="md:col-span-2 space-y-4">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <FileText size={20} />
            {SUBJECTS.find(s => s.id === selectedSubject)?.name} 文件库
            <span className="text-xs font-normal opacity-40 ml-2">
              ({files.filter(f => f.subject === selectedSubject).length} 个文件)
            </span>
          </h3>
          
          <div className="space-y-2 max-h-[300px] md:max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {files.filter(f => f.subject === selectedSubject).map(file => (
              <div key={file.id} className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-white rounded-2xl border border-[#141414]/5 group hover:shadow-md transition-all">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-[#141414]/5 flex items-center justify-center flex-shrink-0">
                  <FileText className="text-[#141414]/60 w-4 h-4 md:w-5 md:h-5" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-medium text-xs md:text-sm truncate">{file.name}</p>
                  <p className="text-[10px] md:text-xs opacity-40">{new Date(file.uploadedAt).toLocaleDateString()}</p>
                </div>
                <button 
                  onClick={() => deleteFile(file.id)}
                  className="p-2 rounded-lg text-red-500 hover:bg-red-50 md:opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            
            {files.filter(f => f.subject === selectedSubject).length === 0 && (
              <div className="py-12 text-center border-2 border-dashed border-[#141414]/5 rounded-3xl">
                <p className="text-sm opacity-40 italic">暂无文件，请先上传资料</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
