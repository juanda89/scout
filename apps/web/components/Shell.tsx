import { AmbientField } from "./AmbientField";

/** Lienzo de página del diseño: fondo #F4F4F6 con el campo ambiental detrás y el contenido por encima. */
export function Shell({ children, fx = 0.5, fy = 0.1, intensity = 1 }: { children: React.ReactNode; fx?: number; fy?: number; intensity?: number }) {
  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", background: "#F4F4F6" }}>
      <AmbientField fx={fx} fy={fy} intensity={intensity} />
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}
