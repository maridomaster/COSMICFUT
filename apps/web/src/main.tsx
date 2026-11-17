import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import { router } from '@/app/router';
import './index.css';

// ferramentas de teste da carreira (somente em desenvolvimento)
if (import.meta.env.DEV) void import('@/dev/careerDev').then((m) => m.installCareerDev());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  </StrictMode>,
);
