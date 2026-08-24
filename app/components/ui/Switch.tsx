'use client';

// Interruptor on/off — reemplaza los <input type="checkbox"> sueltos en formularios de
// permisos/preferencias. Mismo lenguaje visual en toda la app: pista gris/indigo + perilla blanca.
export function Switch({
  checked, onChange, disabled = false, label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string; // accesible, no se muestra (el texto visible vive al lado, fuera del botón)
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full
        transition-colors duration-200 focus:outline-none focus-visible:ring-2
        focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1
        dark:focus-visible:ring-offset-zinc-900
        ${checked ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-zinc-700'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm
          transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
      />
    </button>
  );
}
