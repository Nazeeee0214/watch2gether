import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ResolveVideoSource = (inputUrl: string): { type: 'DIRECT' | 'PLATFORM'; finalUrl: string } => {
  const isDirectFile = /\.(mp4|m3u8|mkv|webm)(\?.*)?$/i.test(inputUrl);
  
  if (isDirectFile) {
    // Append your self-hosted proxy address to circumvent missing Access-Control-Allow-Origin headers
    const proxyPrefix = process.env.NEXT_PUBLIC_CORS_PROXY_URL || 
      (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8085/` : 'http://localhost:8085/');
    return {
      type: 'DIRECT',
      finalUrl: `${proxyPrefix}${inputUrl}`
    };
  }
  
  // Return unmodified URL; ReactPlayer automatically hooks the correct Frame API wrapper internally
  return {
    type: 'PLATFORM',
    finalUrl: inputUrl
  };
};
