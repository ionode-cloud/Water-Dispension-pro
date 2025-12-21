import React from "react";

const WaterJar = ({ remaining = 500, tankCapacity = 500, label = "Water Tank" }) => {
  const heightPercent = (remaining / tankCapacity) * 100;

  return (
    <div className="flex flex-col items-center gap-5 p-5 rounded-2xl">
      {/* Tank */}
      <div className="relative w-60 h-70 mt-5 border-4 border-gray-300 rounded-2xl overflow-hidden flex items-end justify-center bg-blue-200 shadow-lg">
        
        {/* Water Level */}
        <div
          className="absolute bottom-0 left-0 w-full overflow-hidden"
          style={{ height: `${heightPercent}%` }}
        >
          <div className="absolute bottom-0 left-0 w-full h-full">
            <div className="wave"></div>
            <div className="wave"></div>
          </div>
        </div>

        {/* Label showing remaining liters */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140px] h-[50px] bg-white/90 border-2 border-blue-400 rounded-lg shadow-md flex items-center justify-center font-bold text-blue-700 text-lg tracking-wide">
          {remaining}L
        </div>
      </div>

      {/* Tank Name */}
      <p className="text-blue-700 font-semibold text-lg uppercase tracking-wide ">
        {label}
      </p>
      <style>{`
        .wave {
          background: url("/src/Components/wave.svg") repeat-x;
          background-size: contain;
          position: absolute;
          bottom: 0;
          width: 6400px;
          height: 198px;
          animation: wave 7s cubic-bezier(.36,.45,.63,.53) infinite;
          transform: translate3d(0,0,0);
        }
        .wave:nth-of-type(2) {
          animation: wave 7s cubic-bezier(.36,.45,.63,.53) -.125s infinite, swell 7s ease -1.25s infinite;
          opacity: 1;
        }
        @keyframes wave {
          0% { margin-left: 0; }
          100% { margin-left: -1600px; }
        }
        @keyframes swell {
          0%, 100% { transform: translate3d(0,-25px,0); }
          50% { transform: translate3d(0,5px,0); }
        }
      `}</style>
    </div>
  );
};

export default WaterJar;
