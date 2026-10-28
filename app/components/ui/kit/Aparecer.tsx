'use client';

// Contenedor que hace entrar a sus hijos escalonados (Tarjeta, Indicador ya traen `item`).
// MotionConfig reducedMotion="user" apaga el movimiento si el sistema pide reducirlo.
import { motion, MotionConfig } from 'framer-motion';
import { lista } from './movimiento';

export function Lista({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div variants={lista} initial="oculto" animate="visible" className={className}>
        {children}
      </motion.div>
    </MotionConfig>
  );
}
