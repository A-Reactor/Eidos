import { createSigilModel, type SigilPrimitive } from "@/lib/ui/sigil";

interface WorldSigilProps {
  seed: string;
  accent: string;
  className?: string;
  label: string;
}

function PrimitiveShape({ primitive }: { primitive: SigilPrimitive }) {
  const half = primitive.size / 2;

  switch (primitive.kind) {
    case "line":
      return <line x1={-half} y1="0" x2={half} y2="0" />;
    case "ring":
      return <circle cx="0" cy="0" r={half} />;
    case "diamond":
      return <polygon points={`0,${-half} ${half},0 0,${half} ${-half},0`} />;
    case "bracket":
      return <path d={`M ${half} ${-half} H ${-half} V ${half} H ${half}`} />;
  }
}

export function WorldSigil({
  seed,
  accent,
  className,
  label,
}: WorldSigilProps) {
  const model = createSigilModel(seed);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      className={className}
      fill="none"
    >
      <g aria-hidden="true" strokeLinecap="square" strokeLinejoin="miter">
        {model.map((primitive, index) => (
          <g
            key={index}
            transform={`translate(${primitive.x} ${primitive.y}) rotate(${primitive.rotation})`}
            stroke={primitive.accent ? accent : "currentColor"}
            strokeWidth="1.5"
          >
            <PrimitiveShape primitive={primitive} />
          </g>
        ))}
      </g>
    </svg>
  );
}
