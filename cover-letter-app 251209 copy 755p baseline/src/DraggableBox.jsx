import React from "react";
import { useDrag, useDrop } from "react-dnd";

export const DraggableBox = ({ id, text, index, moveBox, onChange }) => {
  const [{ isDragging }, drag] = useDrag({
    type: "BOX",
    item: { id, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "BOX",
    hover(item) {
      if (item.index !== index) {
        moveBox(item.index, index);
        item.index = index;
      }
    },
  });

  return (
    <span
      ref={(node) => drag(drop(node))}
      contentEditable
      suppressContentEditableWarning
      style={{
        display: "inline-block",
        padding: "2px 6px",
        margin: "2px",
        border: "1px solid #007bff",
        borderRadius: "4px",
        backgroundColor: "#e7f1ff",
        cursor: "move",
        opacity: isDragging ? 0.5 : 1,
        userSelect: "all",
      }}
      onInput={(e) => onChange(index, e.currentTarget.innerText)}
    >
      {text || `Field ${index + 1}`}
    </span>
  );
};
