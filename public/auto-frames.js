(function () {
  const DEFAULT_PADDING = 32;
  const MIN_FRAME_SIZE = 100;
  const EPSILON = 0.5;
  const FIT_RETRY_SAFETY_BUFFERS = [0, 2, 6, 12];
  const CONTAINMENT_ERROR_FRAGMENT = 'children would exist outside the parent frame';
  const LOG_PREFIX = 'Shrink frame to content';

  function isFiniteNumber(value) {
    return Number.isFinite(value);
  }

  function sanitizePadding(rawValue) {
    if (!isFiniteNumber(Number(rawValue))) {
      return DEFAULT_PADDING;
    }

    return Math.max(0, Math.min(200, Math.round(Number(rawValue))));
  }

  function isFrame(item) {
    return item && item.type === 'frame';
  }

  function frameLabel(frame) {
    if (frame.title && String(frame.title).trim()) {
      return String(frame.title).trim();
    }

    return `Frame ${frame.id}`;
  }

  function getRotatedBounds(item) {
    const hasGeometry =
      isFiniteNumber(item.x) &&
      isFiniteNumber(item.y) &&
      isFiniteNumber(item.width) &&
      isFiniteNumber(item.height);

    if (!hasGeometry) {
      return null;
    }

    const rotation = isFiniteNumber(item.rotation) ? item.rotation : 0;
    const radians = (rotation * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const rotatedWidth = item.width * cosine + item.height * sine;
    const rotatedHeight = item.width * sine + item.height * cosine;

    return {
      bottom: item.y + rotatedHeight / 2,
      height: rotatedHeight,
      left: item.x - rotatedWidth / 2,
      right: item.x + rotatedWidth / 2,
      top: item.y - rotatedHeight / 2,
      width: rotatedWidth,
    };
  }

  function mergeBounds(bounds) {
    return bounds.reduce(
      (accumulator, currentBounds) => {
        return {
          bottom: Math.max(accumulator.bottom, currentBounds.bottom),
          left: Math.min(accumulator.left, currentBounds.left),
          right: Math.max(accumulator.right, currentBounds.right),
          top: Math.min(accumulator.top, currentBounds.top),
        };
      },
      {
        bottom: -Infinity,
        left: Infinity,
        right: -Infinity,
        top: Infinity,
      },
    );
  }

  function createFitPlan(frame, children, padding, safetyBuffer) {
    if (!children.length) {
      return {
        reason: 'Empty frame.',
        status: 'skipped',
      };
    }

    const measurableChildren = [];
    const unmeasurableChildren = [];

    for (const child of children) {
      const bounds = getRotatedBounds(child);
      if (!bounds) {
        unmeasurableChildren.push(child);
        continue;
      }

      measurableChildren.push({
        bounds,
        child,
      });
    }

    if (unmeasurableChildren.length) {
      const unsupportedTypes = [...new Set(unmeasurableChildren.map((child) => child.type || 'unknown'))].join(', ');
      return {
        reason: `Unsupported items: ${unsupportedTypes}.`,
        status: 'skipped',
        unmeasurableChildren,
      };
    }

    const mergedBounds = mergeBounds(measurableChildren.map((entry) => entry.bounds));
    const effectivePadding = padding + safetyBuffer;
    const targetWidth = mergedBounds.right - mergedBounds.left + effectivePadding * 2;
    const targetHeight = mergedBounds.bottom - mergedBounds.top + effectivePadding * 2;
    const newWidth = Math.max(MIN_FRAME_SIZE, targetWidth);
    const newHeight = Math.max(MIN_FRAME_SIZE, targetHeight);
    const extraWidth = newWidth - targetWidth;
    const extraHeight = newHeight - targetHeight;

    const originalLeft = frame.x - frame.width / 2;
    const originalTop = frame.y - frame.height / 2;

    const newLeft = originalLeft + mergedBounds.left - effectivePadding - extraWidth / 2;
    const newTop = originalTop + mergedBounds.top - effectivePadding - extraHeight / 2;
    const newX = newLeft + newWidth / 2;
    const newY = newTop + newHeight / 2;
    const deltaX = originalLeft - newLeft;
    const deltaY = originalTop - newTop;

    const hasChanged =
      Math.abs(frame.x - newX) > EPSILON ||
      Math.abs(frame.y - newY) > EPSILON ||
      Math.abs(frame.width - newWidth) > EPSILON ||
      Math.abs(frame.height - newHeight) > EPSILON;

    if (!hasChanged) {
      return {
        childCount: children.length,
        reason: 'Already fits.',
        status: 'noop',
      };
    }

    return {
      childCount: children.length,
      deltaX,
      deltaY,
      effectivePadding,
      newHeight,
      newWidth,
      newX,
      newY,
      safetyBuffer,
      status: 'ready',
    };
  }

  function isContainmentError(error) {
    const message = error && error.message ? String(error.message).toLowerCase() : '';
    return message.includes(CONTAINMENT_ERROR_FRAGMENT);
  }

  async function ensureTemporaryRoom(frame, children, plan) {
    let requiredWidth = frame.width;
    let requiredHeight = frame.height;

    if (plan.deltaX <= EPSILON && plan.deltaY <= EPSILON) {
      return;
    }

    for (const child of children) {
      const bounds = getRotatedBounds(child);
      if (!bounds) {
        continue;
      }

      if (plan.deltaX > EPSILON) {
        requiredWidth = Math.max(requiredWidth, bounds.right + plan.deltaX);
      }

      if (plan.deltaY > EPSILON) {
        requiredHeight = Math.max(requiredHeight, bounds.bottom + plan.deltaY);
      }
    }

    if (requiredWidth <= frame.width + EPSILON && requiredHeight <= frame.height + EPSILON) {
      return;
    }

    const originalLeft = frame.x - frame.width / 2;
    const originalTop = frame.y - frame.height / 2;

    frame.width = requiredWidth;
    frame.height = requiredHeight;
    frame.x = originalLeft + requiredWidth / 2;
    frame.y = originalTop + requiredHeight / 2;
    await frame.sync();
  }

  async function applyFitPlan(frame, children, plan) {
    await ensureTemporaryRoom(frame, children, plan);

    for (const child of children) {
      child.x += plan.deltaX;
      child.y += plan.deltaY;
      await child.sync();
    }

    frame.x = plan.newX;
    frame.y = plan.newY;
    frame.width = plan.newWidth;
    frame.height = plan.newHeight;
    await frame.sync();
  }

  async function restoreOriginalState(frame, originalFrame, originalChildren) {
    for (const entry of originalChildren) {
      entry.child.x = entry.x;
      entry.child.y = entry.y;
      await entry.child.sync();
    }

    frame.x = originalFrame.x;
    frame.y = originalFrame.y;
    frame.width = originalFrame.width;
    frame.height = originalFrame.height;
    await frame.sync();
  }

  async function fitFrame(frame, options) {
    const padding = sanitizePadding(options && options.padding);
    const label = frameLabel(frame);
    const children = await frame.getChildren();
    const initialPlan = createFitPlan(frame, children, padding, 0);

    if (initialPlan.status === 'skipped' || initialPlan.status === 'noop') {
      return {
        childCount: initialPlan.childCount || children.length,
        frameId: frame.id,
        frameLabel: label,
        message: initialPlan.reason,
        status: initialPlan.status,
      };
    }

    const originalFrame = {
      height: frame.height,
      width: frame.width,
      x: frame.x,
      y: frame.y,
    };

    const originalChildren = children.map((child) => ({
      child,
      x: child.x,
      y: child.y,
    }));

    for (let index = 0; index < FIT_RETRY_SAFETY_BUFFERS.length; index += 1) {
      const safetyBuffer = FIT_RETRY_SAFETY_BUFFERS[index];
      const plan = safetyBuffer === 0 ? initialPlan : createFitPlan(frame, children, padding, safetyBuffer);
      const nextSafetyBuffer = FIT_RETRY_SAFETY_BUFFERS[index + 1];

      try {
        await applyFitPlan(frame, children, plan);

        return {
          childCount: plan.childCount,
          frameId: frame.id,
          frameLabel: label,
          message: `${plan.childCount} item${plan.childCount === 1 ? '' : 's'}, minimum ${padding} dp padding.`,
          padding,
          status: 'success',
        };
      } catch (error) {
        const shouldRetry = Boolean(nextSafetyBuffer) && isContainmentError(error);

        try {
          await restoreOriginalState(frame, originalFrame, originalChildren);
        } catch (rollbackError) {
          console.error(`${LOG_PREFIX} failed to roll back ${label}`, rollbackError);
          return {
            childCount: plan.childCount,
            error,
            frameId: frame.id,
            frameLabel: label,
            message: error && error.message ? error.message : 'Resize failed.',
            status: 'error',
          };
        }

        if (shouldRetry) {
          console.warn(
            `${LOG_PREFIX} is retrying ${label} with an extra ${nextSafetyBuffer} dp safety buffer.`,
            error,
          );
          continue;
        }

        console.error(`${LOG_PREFIX} failed to fit ${label}`, error);

        return {
          childCount: plan.childCount,
          error,
          frameId: frame.id,
          frameLabel: label,
          message: error && error.message ? error.message : 'Resize failed.',
          status: 'error',
        };
      }
    }

    return {
      childCount: initialPlan.childCount,
      frameId: frame.id,
      frameLabel: label,
      message: 'Resize failed.',
      status: 'error',
    };
  }

  async function fitSelectedFrames(options) {
    const selection = await miro.board.getSelection();
    const frames = selection.filter(isFrame);
    const results = [];

    for (const frame of frames) {
      results.push(await fitFrame(frame, options));
    }

    const summary = {
      errorCount: results.filter((result) => result.status === 'error').length,
      frameCount: frames.length,
      noopCount: results.filter((result) => result.status === 'noop').length,
      skippedCount: results.filter((result) => result.status === 'skipped').length,
      successCount: results.filter((result) => result.status === 'success').length,
    };

    return {
      frames,
      results,
      selection,
      summary,
    };
  }

  window.AutoFrames = {
    DEFAULT_PADDING,
    fitFrame,
    fitSelectedFrames,
    frameLabel,
    isFrame,
    sanitizePadding,
  };
})();
