import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import { router } from '@/app/router';
import './index.css';

// site oficial aberto por http:// (link antigo): o relay só aceita a origem https — vai para o endereço seguro
if (typeof window !== 'undefined' && window.location.protocol === 'http:' && /(^|\.)cosmicpacks\.io$|\.github\.io$/.test(window.location.hostname)) {
  window.location.replace(window.location.href.replace(/^http:/, 'https:'));
}

// ferramentas de teste da carreira (somente em desenvolvimento)
if (import.meta.env.DEV) void import('@/dev/careerDev').then((m) => m.installCareerDev());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  </StrictMode>,
);
