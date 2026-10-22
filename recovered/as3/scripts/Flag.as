package
{
   import flash.display.Bitmap;
   import flash.display.BitmapData;
   import flash.display.DisplayObject;
   import flash.display.Shape;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.filters.DisplacementMapFilter;
   import flash.filters.DropShadowFilter;
   import flash.geom.Matrix;
   import flash.geom.Point;
   
   public class Flag extends Sprite
   {
      
      public var source:DisplayObject;
      
      public var sourceBitmapData:BitmapData;
      
      public var output:Bitmap;
      
      public var outputBitmapData:BitmapData;
      
      public var perlinNoiseBitmapData:BitmapData;
      
      public var perlinNoiseFallOff:BitmapData;
      
      public var srcWidth:Number;
      
      public var srcHeight:Number;
      
      public var origi:Point;
      
      public var offsets:Array;
      
      public var animated:Boolean;
      
      public function Flag(param1:DisplayObject, param2:Boolean = false)
      {
         super();
         this.source = param1;
         this.animated = param2;
         this.init();
      }
      
      private function init() : void
      {
         this.assemble();
         this.output = new Bitmap();
         this.output.bitmapData = this.outputBitmapData;
         this.output.filters = [this.getDisplacementMapFilter(),new DropShadowFilter(4,45,0,0.5)];
         addChild(this.output);
         addEventListener(Event.ENTER_FRAME,this.render);
         addEventListener(Event.REMOVED_FROM_STAGE,this.destory);
      }
      
      private function assemble() : void
      {
         x = this.source.x;
         y = this.source.y;
         this.srcWidth = this.source.width;
         this.srcHeight = this.source.height;
         this.origi = new Point();
         this.offsets = [new Point()];
         this.sourceBitmapData = new BitmapData(this.srcWidth,this.srcHeight,true,0);
         this.sourceBitmapData.draw(this.source);
         this.outputBitmapData = new BitmapData(this.srcWidth,this.srcHeight,true,0);
         this.perlinNoiseBitmapData = new BitmapData(this.srcWidth * 1.2,this.srcHeight * 1.2);
         this.perlinNoiseFallOff = new BitmapData(this.srcWidth * 1.2,this.srcHeight * 1.2,true,0);
         var _loc1_:Shape = new Shape();
         var _loc2_:Matrix = new Matrix();
         _loc2_.createGradientBox(this.srcWidth * 1.2,this.srcHeight * 1.2,Math.PI / 2,0,25);
         _loc1_.graphics.beginGradientFill("linear",[8421504,8421504],[99,0],[0,96],_loc2_);
         _loc1_.graphics.drawRect(0,0,this.srcWidth * 1.2,this.srcHeight * 1.2);
         _loc1_.graphics.endFill();
         this.perlinNoiseFallOff.draw(_loc1_);
      }
      
      private function getDisplacementMapFilter() : DisplacementMapFilter
      {
         return new DisplacementMapFilter(this.perlinNoiseBitmapData,new Point(0,-this.srcHeight * 0.1),2,4,0.125 * this.srcWidth,0.125 * this.srcHeight,"color");
      }
      
      private function render(param1:Event) : void
      {
         if(this.animated)
         {
            this.sourceBitmapData.draw(this.source);
         }
         this.offsets[0].y -= 0.05 * this.srcWidth;
         this.perlinNoiseBitmapData.perlinNoise(0.55 * this.srcWidth,0.55 * this.srcHeight,1,0,true,true,1,true,this.offsets);
         this.perlinNoiseBitmapData.copyPixels(this.perlinNoiseFallOff,this.perlinNoiseFallOff.rect,this.origi,this.perlinNoiseFallOff,this.origi,true);
         this.outputBitmapData.copyPixels(this.sourceBitmapData,this.sourceBitmapData.rect,this.origi);
      }
      
      private function destory(param1:Event) : void
      {
         removeEventListener(Event.ENTER_FRAME,this.render);
         removeEventListener(Event.REMOVED_FROM_STAGE,this.destory);
      }
   }
}

