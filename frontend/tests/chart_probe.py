def click_turning_point(canvas):
    canvas.scroll_into_view_if_needed()
    x, y = canvas.evaluate("""canvas => {
      const {width, height} = canvas;
      const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const dots = [];
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const index = (row * width + column) * 4;
        if (rgba[index] === 174 && rgba[index + 1] === 91 && rgba[index + 2] === 35 && rgba[index + 3] === 255)
          dots.push([column, row]);
      }
      if (!dots.length) throw new Error('Turning-point marker missing');
      const [x, y] = dots[Math.floor(dots.length / 2)];
      const box = canvas.getBoundingClientRect();
      return [x * box.width / width, y * box.height / height];
    }""")
    canvas.click(position={"x": x, "y": y})
