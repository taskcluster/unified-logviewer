import React from 'react';
import shallowCompare from 'react-addons-shallow-compare'
import throttle from 'lodash.throttle';
import { Range } from 'immutable';

export const getScrollPercent = () => {
  const html = document.documentElement;
  const body = document.body;

  return (html.scrollTop || body.scrollTop) / ((html.scrollHeight || body.scrollHeight) - html.clientHeight);
};

export default class LazyList extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      renderIndices: Range(0, 0),
      jumpToLine: 0
    };

    this.handleScroll = throttle(::this.handleScroll, 300);
    this.handleUnload = ::this.handleUnload;
  }

  shouldComponentUpdate(nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState);
  }

  componentWillMount() {
    window.addEventListener('scroll', this.handleScroll);
    window.addEventListener('beforeunload', this.handleUnload);
  }

  componentWillUnmount() {
    window.removeEventListener('scroll', this.handleScroll);
  }

  componentDidMount() {
    this.handleLineJump().then(() => {
      this.handleScroll();
      this.setState({ jumpToLine: null });
    });
  }

  handleScroll() {
    const buffer = this.props.buffer;
    const percent = getScrollPercent();
    const { jumpToLine } = this.state;
    const index = jumpToLine ? jumpToLine : Math.floor((this.props.list.length - 1) * percent);
    const start = Math.max(0, index - buffer);
    const end = Math.min(this.props.list.length, index + buffer + 1);
    const range = Range(start, end);

    if (!range.equals(this.state.renderIndices)) {
      this.setState({ renderIndices: range });
    }
  }

  handleLineJump() {
    const { highlightStart, offset, LINE_CHUNK } = this.props.metadata;

    return new Promise((resolve) => {
      this.setState({ jumpToLine: Math.floor((highlightStart - (offset + 1)) / LINE_CHUNK) }, () => resolve());
    });
  }

  handleUnload() {
    window.scrollTo(0, 0);
  }

  render() {
    const { list, children } = this.props;
    const { renderIndices } = this.state;
    const shouldLoad = (index) => renderIndices.includes(index);

    return (
      <div className="lazy-list">
        {children(list, shouldLoad)}
      </div>
    );
  }
}

LazyList.defaultProps = {
  list: [],
  buffer: 0
};
