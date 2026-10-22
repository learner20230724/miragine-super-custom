package miragine3d_fla
{
   import adobe.utils.*;
   import flash.accessibility.*;
   import flash.desktop.*;
   import flash.display.*;
   import flash.errors.*;
   import flash.events.*;
   import flash.external.*;
   import flash.filters.*;
   import flash.geom.*;
   import flash.globalization.*;
   import flash.media.*;
   import flash.net.*;
   import flash.net.drm.*;
   import flash.printing.*;
   import flash.profiler.*;
   import flash.sampler.*;
   import flash.sensors.*;
   import flash.system.*;
   import flash.text.*;
   import flash.text.engine.*;
   import flash.text.ime.*;
   import flash.ui.*;
   import flash.utils.*;
   import flash.xml.*;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol258")]
   public dynamic class unit_over_65 extends MovieClip
   {
      
      public var lose:MovieClip;
      
      public var win:MovieClip;
      
      public var home:SimpleButton;
      
      public var replay:SimpleButton;
      
      public function unit_over_65()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      public function onClick(param1:*) : *
      {
         if(param1.currentTarget == this.home)
         {
            Object(root).gotoAndStop("title");
         }
         else
         {
            Object(root).gotoAndStop("game");
         }
      }
      
      internal function frame1() : *
      {
         this.replay.addEventListener("click",this.onClick);
         this.home.addEventListener("click",this.onClick);
      }
   }
}

