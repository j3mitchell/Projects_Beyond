// src/DraggableBox.js
import React from "react";
import { useDrag } from "react-dnd";

export const DraggableBox = ({ id, text, index, onChange }) => {
  const [{ isDragging }, drag] = useDrag({
    type: "BOX",
    item: { id, text },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  return (
    <span
      ref={drag}
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => onChange(index, e.currentTarget.innerText)}
      style={{
        display: "inline-block",
        padding: "4px 8px",
        margin: "6px 6px 6px 0",
        border: "1px solid #007bff",
        borderRadius: 6,
        background: "#e7f1ff",
        cursor: "move",
        userSelect: "all",
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {text || `Field ${index + 1}`}
    </span>
  );
};
